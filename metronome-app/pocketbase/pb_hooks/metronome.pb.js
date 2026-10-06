/// <reference path="../pb_data/types.d.ts" />

// Group sync API for the metronome app (https://hutchies.github.io/metronome2/).
// Collections are created by pb_migrations/1790000000_metronome_collections.js.
//
//   GET    /api/metronome/time                         server clock, for NTP-style sync
//   POST   /api/metronome/rooms                        create a room (X-Host-Key: new secret)
//   GET    /api/metronome/rooms/{code}                 room details (+ isHost if X-Host-Key given)
//   PATCH  /api/metronome/rooms/{code}                 leader: name / map / settings
//
// Room changes, joins and leaves append a `room` cue so subscribers refetch.
//   GET    /api/metronome/rooms/{code}/cues            the room's cue log, in order
//   POST   /api/metronome/rooms/{code}/cues            leader: append a cue
//   POST   /api/metronome/rooms/{code}/members         join / heartbeat (X-Member-Key), returns members
//   DELETE /api/metronome/rooms/{code}/members/{id}    leave (X-Member-Key)
//
// Clients subscribe to new cues with PocketBase realtime on `metronome_cues`,
// passing the room code as the X-Room-Code header option.

routerAdd('GET', '/api/metronome/time', (e) => {
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, { now: Date.now() });
});

routerAdd('POST', '/api/metronome/rooms', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const key = lib.header(e, 'X-Host-Key');
  if (key.length < 16) throw new BadRequestError('Missing or short X-Host-Key header.');
  const b = lib.body(e);
  const room = new Record(e.app.findCollectionByNameOrId('metronome_rooms'));
  room.set('code', lib.newCode(e.app));
  room.set('name', lib.str(b.name, 80));
  room.set('map', lib.str(b.map, 100000));
  room.set('settings', lib.cleanSettings(b.settings));
  room.set('hostKeyHash', lib.keyHash(key));
  lib.extend(room);
  e.app.save(room);
  return e.json(200, Object.assign(lib.roomJson(room), { isHost: true }));
});

routerAdd('GET', '/api/metronome/rooms/{code}', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  return e.json(200, Object.assign(lib.roomJson(room), { isHost: lib.isHost(e, room) }));
});

routerAdd('PATCH', '/api/metronome/rooms/{code}', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  lib.requireHost(e, room);
  const b = lib.body(e);
  if (b.name !== undefined) room.set('name', lib.str(b.name, 80));
  if (b.map !== undefined) room.set('map', lib.str(b.map, 100000));
  if (b.settings !== undefined) room.set('settings', lib.cleanSettings(b.settings));
  lib.extend(room);
  e.app.save(room);
  // Tell subscribers to refetch the room.
  lib.appendCue(e.app, room, 'room', Date.now(), {}, lib.str(b.by, 64));
  return e.json(200, Object.assign(lib.roomJson(room), { isHost: true }));
});

routerAdd('GET', '/api/metronome/rooms/{code}/cues', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  const after = Math.max(0, Math.floor(Number(e.request.url.query().get('after')) || 0));
  const cues = e.app.findRecordsByFilter(
    'metronome_cues',
    'room = {:room} && seq > {:after}',
    'seq',
    5000,
    0,
    { room: room.id, after: after },
  );
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, cues);
});

routerAdd('POST', '/api/metronome/rooms/{code}/cues', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  lib.requireHost(e, room);
  const b = lib.body(e);
  const kind = String(b.kind || '');
  if (lib.TIMED_KINDS.indexOf(kind) < 0) throw new BadRequestError('Unknown cue kind.');
  const now = Date.now();
  let at = Number(b.at);
  if (!isFinite(at)) throw new BadRequestError('Missing `at`.');
  if (at > now + lib.MAX_LEAD_MS) throw new BadRequestError('`at` is too far ahead.');
  // A cue that would already be in the past (slow network, or a badly synced
  // leader) is pushed just into the future, so every device still agrees on it.
  if (at < now + lib.MIN_LEAD_MS) at = now + lib.MIN_LEAD_MS;
  const payload = b.payload && typeof b.payload === 'object' ? b.payload : {};
  const cue = lib.appendCue(e.app, room, kind, Math.round(at), payload, lib.str(b.by, 64));
  return e.json(200, cue);
});

routerAdd('POST', '/api/metronome/rooms/{code}/members', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  const key = lib.header(e, 'X-Member-Key');
  if (key.length < 16) throw new BadRequestError('Missing or short X-Member-Key header.');
  const b = lib.body(e);
  const clientId = lib.str(b.clientId, 64);
  if (!clientId) throw new BadRequestError('Missing clientId.');
  let m = lib.findMember(e.app, room, clientId);
  const joined = !m;
  if (m) {
    if (m.getString('keyHash') !== lib.keyHash(key)) throw new ForbiddenError('That member belongs to someone else.');
  } else {
    m = new Record(e.app.findCollectionByNameOrId('metronome_members'));
    m.set('room', room.id);
    m.set('clientId', clientId);
    m.set('keyHash', lib.keyHash(key));
  }
  m.set('displayName', lib.str(b.displayName, 40));
  m.set('part', lib.str(b.part, 40));
  m.set('kind', b.kind === 'countdown' ? 'countdown' : 'app');
  m.set('ready', !!b.ready);
  m.set('leader', lib.isHost(e, room));
  m.set('rttMs', Math.round(lib.num(b.rttMs, 0, 60000)));
  m.set('offsetErrMs', Math.round(lib.num(b.offsetErrMs, 0, 60000) * 10) / 10);
  m.set('countInSec', Math.round(lib.num(b.countInSec, 0, 60) * 1000) / 1000);
  // Saving bumps `updated` (an autodate), which is the presence heartbeat.
  e.app.save(m);
  // Tell everyone (the leader's player list especially) that someone joined.
  if (joined) lib.appendCue(e.app, room, 'room', Date.now(), { members: true }, clientId);
  return e.json(200, { member: m, members: lib.memberList(e.app, room), room: lib.roomJson(room) });
});

routerAdd('DELETE', '/api/metronome/rooms/{code}/members/{clientId}', (e) => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const room = lib.findRoom(e.app, e.request.pathValue('code'));
  const key = lib.header(e, 'X-Member-Key');
  const m = lib.findMember(e.app, room, e.request.pathValue('clientId'));
  if (m) {
    if (m.getString('keyHash') !== lib.keyHash(key)) throw new ForbiddenError('That member belongs to someone else.');
    e.app.delete(m);
    lib.appendCue(e.app, room, 'room', Date.now(), { members: true }, m.getString('clientId'));
  }
  return e.noContent(204);
});

// Housekeeping: rooms expire 24 h after their last use (members and cues are
// cascade-deleted with them), and long-gone members are tidied up.
cronAdd('metronome_cleanup', '*/15 * * * *', () => {
  const lib = require(`${__hooks}/metronome_lib.js`);
  const now = lib.pbDate(Date.now());
  for (const r of $app.findRecordsByFilter('metronome_rooms', 'expires < {:now}', '', 500, 0, { now: now })) {
    $app.delete(r);
  }
  const stale = lib.pbDate(Date.now() - 60 * 60 * 1000);
  for (const m of $app.findRecordsByFilter('metronome_members', 'updated < {:t}', '', 1000, 0, { t: stale })) {
    $app.delete(m);
  }
});
