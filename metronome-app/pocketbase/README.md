# Group sync server (PocketBase)

The metronome's "Play together" feature needs a small PocketBase backend: a clock to sync against, rooms, presence, and a log of timed cues. Everything here is prefixed `metronome_`, so it can share an existing PocketBase instance with other projects.

```
pb_migrations/1790000000_metronome_collections.js   creates metronome_rooms, metronome_members, metronome_cues
pb_hooks/metronome.pb.js                            the /api/metronome/* routes and an expiry cron job
pb_hooks/metronome_lib.js                           helpers (required by the routes; not a hook file itself)
run-local.sh                                        run a local PocketBase with all of the above
```

Requires PocketBase v0.23 or later (the current JS hooks API). Tested with v0.40.4.

## Installing on an existing server (hutchies.cc)

1. Copy `pb_hooks/metronome.pb.js` and `pb_hooks/metronome_lib.js` into the server's `pb_hooks/` directory.
2. Copy `pb_migrations/1790000000_metronome_collections.js` into its `pb_migrations/` directory.
3. Restart PocketBase. `serve` applies pending migrations on start; hooks are picked up on start too (and reloaded automatically when they change).
4. Check it: `curl https://hutchies.cc/api/metronome/time` should return `{"now": …}`.

**Updating:** copy the changed files over and restart (or just copy: PocketBase reloads hooks when they change). The October 6 updates (parts assigned by the leader; live player list) changed `pb_hooks/metronome_lib.js` and `pb_hooks/metronome.pb.js`; there's no new migration.

The app's default server is `https://hutchies.cc`. Players can point it elsewhere under Play together → Server.

If the instance has rate limiting enabled, make sure it allows short bursts to `/api/metronome/time`: each player sends 12 requests in quick succession on joining, then 4 every 15 s.

To remove it all, delete the two hook files and the migration file, then delete the three `metronome_` collections in the dashboard.

## API

All writes go through these routes, which check the room's secrets; the collections themselves are locked down. The only collection rule lets a client that knows a room's code (sent as the `X-Room-Code` header, which also works as a realtime subscription option) read that room's cues.

| Route | Who | |
|---|---|---|
| `GET /api/metronome/time` | anyone | `{ now }`, server clock in ms |
| `POST /api/metronome/rooms` | anyone | create a room; `X-Host-Key` header is the new room's leader secret (stored hashed) |
| `GET /api/metronome/rooms/{code}` | anyone | room details; `isHost` says whether `X-Host-Key` is valid |
| `PATCH /api/metronome/rooms/{code}` | leader | update name, shared map or settings; appends a `room` cue so clients refetch |
| `GET /api/metronome/rooms/{code}/cues?after=N` | anyone | the cue log, by sequence number |
| `POST /api/metronome/rooms/{code}/cues` | leader | append a cue: `{ kind, at, payload }`. The server assigns `seq`, rejects `at` more than 60 s ahead, and moves an `at` that is already past to just ahead of now |
| `POST /api/metronome/rooms/{code}/members` | anyone | join or heartbeat (`X-Member-Key` protects the row); returns all recently seen members |
| `DELETE /api/metronome/rooms/{code}/members/{clientId}` | that member | leave |

Rooms expire 24 hours after their last cue or update; members and cues are deleted with them. A cron job (every 15 minutes) does the clean-up.

## Running it in the rehearsal room

`run-local.sh` builds the app and serves it from a local PocketBase together with the hooks (put the PocketBase binary next to the script first). Round trips on a LAN are 1–3 ms, so clock sync gets to about ±1–2 ms.

There's one catch: browsers only allow the audio engine (AudioWorklet) on secure pages, i.e. HTTPS or `localhost`. Plain `http://192.168.x.x:8090` works on the laptop itself (as `http://localhost:8090`) but not on other devices. For other devices, put PocketBase behind HTTPS on the local network, for example:

- a real domain whose DNS points at the laptop's LAN address, with a certificate from a DNS challenge (e.g. Caddy with a DNS plugin), or
- Caddy with `tls internal`, after installing its root certificate on each device.

Then set Play together → Server to that address on every device. An HTTPS page (such as the GitHub Pages copy of the app) can't talk to a plain-HTTP server, so the server needs HTTPS either way.
