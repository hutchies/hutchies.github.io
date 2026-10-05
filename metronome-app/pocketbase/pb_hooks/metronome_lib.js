// Helpers for metronome.pb.js. PocketBase runs each route handler in its own
// JS context, so handlers `require()` this file rather than sharing globals.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LENGTH = 5;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** Members that haven't sent a heartbeat for this long are dropped from lists. */
const MEMBER_LIST_MS = 2 * 60 * 1000;
/** Cue `at` bounds relative to the server's clock. */
const MIN_LEAD_MS = 20;
const MAX_LEAD_MS = 60 * 1000;
const TIMED_KINDS = ['start', 'stop', 'pause', 'release', 'update', 'seek'];
const KINDS = TIMED_KINDS.concat(['room']);

/** PocketBase's date format, e.g. "2026-10-05 09:16:00.000Z". */
function pbDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

function header(e, name) {
  return e.request.header.get(name) || '';
}

function body(e) {
  return e.requestInfo().body || {};
}

function newCode(app) {
  for (let i = 0; i < 20; i++) {
    const code = $security.randomStringWithAlphabet(CODE_LENGTH, CODE_ALPHABET);
    try {
      app.findFirstRecordByFilter('metronome_rooms', 'code = {:code}', { code: code });
    } catch {
      return code;
    }
  }
  throw new BadRequestError('Could not allocate a room code, please try again.');
}

function findRoom(app, code) {
  code = String(code || '').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new NotFoundError('No room with that code.');
  try {
    return app.findFirstRecordByFilter('metronome_rooms', 'code = {:code}', { code: code });
  } catch {
    throw new NotFoundError('No room with that code.');
  }
}

function keyHash(key) {
  return $security.sha256(key);
}

function isHost(e, room) {
  const key = header(e, 'X-Host-Key');
  return key.length >= 16 && keyHash(key) === room.getString('hostKeyHash');
}

function requireHost(e, room) {
  if (!isHost(e, room)) throw new ForbiddenError('Only the leader can do that.');
}

function cleanSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return { releaseLeadMs: Math.round(num(s.releaseLeadMs === undefined ? 250 : s.releaseLeadMs, 30, 1000)) };
}

function roomJson(room) {
  return {
    id: room.id,
    code: room.getString('code'),
    name: room.getString('name'),
    map: room.getString('map'),
    settings: cleanSettings(JSON.parse(room.getString('settings') || '{}')),
    expires: room.getString('expires'),
    updated: room.getString('updated'),
  };
}

function extend(room) {
  room.set('expires', pbDate(Date.now() + ROOM_TTL_MS));
}

/** Appends a cue to the room's log, assigning the next sequence number. */
function appendCue(app, room, kind, at, payload, by) {
  let saved = null;
  app.runInTransaction((tx) => {
    let seq = 1;
    const last = tx.findRecordsByFilter('metronome_cues', 'room = {:room}', '-seq', 1, 0, { room: room.id });
    if (last.length) seq = last[0].getInt('seq') + 1;
    const cue = new Record(tx.findCollectionByNameOrId('metronome_cues'));
    cue.set('room', room.id);
    cue.set('seq', seq);
    cue.set('kind', kind);
    cue.set('at', at);
    cue.set('payload', payload || {});
    cue.set('by', by || '');
    tx.save(cue);
    // Keep rooms that are in use alive (but don't rewrite the room on every cue).
    const expires = new Date(room.getString('expires').replace(' ', 'T')).getTime();
    if (!(expires - Date.now() > ROOM_TTL_MS - 60 * 60 * 1000)) {
      extend(room);
      tx.save(room);
    }
    saved = cue;
  });
  return saved;
}

function findMember(app, room, clientId) {
  try {
    return app.findFirstRecordByFilter('metronome_members', 'room = {:room} && clientId = {:cid}', {
      room: room.id,
      cid: String(clientId || ''),
    });
  } catch {
    return null;
  }
}

function memberList(app, room) {
  return app.findRecordsByFilter(
    'metronome_members',
    'room = {:room} && updated > {:since}',
    'created',
    200,
    0,
    { room: room.id, since: pbDate(Date.now() - MEMBER_LIST_MS) },
  );
}

module.exports = {
  KINDS,
  TIMED_KINDS,
  MIN_LEAD_MS,
  MAX_LEAD_MS,
  pbDate,
  str,
  num,
  header,
  body,
  newCode,
  findRoom,
  keyHash,
  isHost,
  requireHost,
  cleanSettings,
  roomJson,
  extend,
  appendCue,
  findMember,
  memberList,
};
