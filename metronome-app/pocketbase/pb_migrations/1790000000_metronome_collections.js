/// <reference path="../pb_data/types.d.ts" />

// Group sync for the metronome app. Everything is prefixed `metronome_` so it
// can share a PocketBase instance with other projects.
//
// All writes go through the custom routes in pb_hooks/metronome.pb.js, so the
// collections themselves are locked down. The only public rule lets a client
// that knows a room's code (sent as the X-Room-Code header) read and subscribe
// to that room's cues.

migrate(
  (app) => {
    const rooms = new Collection({
      type: 'base',
      name: 'metronome_rooms',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'code', type: 'text', required: true, min: 5, max: 5, pattern: '^[A-Z0-9]+$' },
        { name: 'name', type: 'text', max: 80 },
        { name: 'hostKeyHash', type: 'text', required: true, hidden: true, max: 64 },
        { name: 'map', type: 'text', max: 100000 },
        { name: 'settings', type: 'json', maxSize: 10000 },
        { name: 'expires', type: 'date', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_metronome_rooms_code` ON `metronome_rooms` (`code`)',
        'CREATE INDEX `idx_metronome_rooms_expires` ON `metronome_rooms` (`expires`)',
      ],
    });
    app.save(rooms);

    const members = new Collection({
      type: 'base',
      name: 'metronome_members',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'room', type: 'relation', required: true, collectionId: rooms.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'clientId', type: 'text', required: true, max: 64 },
        { name: 'keyHash', type: 'text', required: true, hidden: true, max: 64 },
        { name: 'displayName', type: 'text', max: 40 },
        { name: 'part', type: 'text', max: 40 },
        { name: 'kind', type: 'select', values: ['app', 'countdown'], maxSelect: 1 },
        { name: 'ready', type: 'bool' },
        { name: 'leader', type: 'bool' },
        { name: 'rttMs', type: 'number' },
        { name: 'offsetErrMs', type: 'number' },
        { name: 'countInSec', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_metronome_members_client` ON `metronome_members` (`room`, `clientId`)'],
    });
    app.save(members);

    const cues = new Collection({
      type: 'base',
      name: 'metronome_cues',
      listRule: 'room.code = @request.headers.x_room_code',
      viewRule: 'room.code = @request.headers.x_room_code',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'room', type: 'relation', required: true, collectionId: rooms.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'seq', type: 'number', required: true, onlyInt: true, min: 1 },
        {
          name: 'kind',
          type: 'select',
          required: true,
          values: ['start', 'stop', 'pause', 'release', 'update', 'seek', 'room'],
          maxSelect: 1,
        },
        { name: 'at', type: 'number', required: true },
        { name: 'payload', type: 'json', maxSize: 10000 },
        { name: 'by', type: 'text', max: 64 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_metronome_cues_seq` ON `metronome_cues` (`room`, `seq`)'],
    });
    app.save(cues);
  },
  (app) => {
    for (const name of ['metronome_cues', 'metronome_members', 'metronome_rooms']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
