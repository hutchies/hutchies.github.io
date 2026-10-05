# Metronome

A metronome for complex, multi-metre music. You build a map of a piece: bars, metres (including additive ones like 3+2+2/8), tempi, rit./accel., pauses and repeats. You can share the whole map as a link and play it back with a sample-accurate audio engine and a rolling display that stays exactly in sync with the audio.

Several players can also start together, each on their own device, accurate to a few milliseconds ("Play together", below).

Built with Svelte 5, TypeScript and Vite. Solo use needs no backend; playing together uses a small PocketBase server (`pocketbase/`), and the PocketBase client is only loaded when you join a room.

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (parser, compiler, transport maths, URL codec, group sync)
METRONOME_PB_URL=https://hutchies.cc npm test   # also check a deployed sync server
npm run check     # svelte-check / TypeScript
npm run build     # static site in dist/
```

While the app lives inside the `hutchies.github.io` repo, it is published by committing a build to `../metronome2/` (served at https://hutchies.github.io/metronome2/):

```sh
npm run deploy:site   # then commit the metronome2/ folder
```

Drop that script once the app moves to its own repository.

The build uses relative paths, so `dist/` can be served from any sub-path, such as a GitHub Pages project site. The workflow in `.github/workflows/deploy.yml` publishes it once this folder is its own repository. In the repo settings, set Pages → Source to "GitHub Actions".

## Using it

- **Blocks** (left panel, or the Edit tab on phones): one compact row per block of bars, pause or repeat: mark, × number of bars, metre and tempo (tap the note symbol to change the beat unit). Empty fields carry on from the previous block, shown as grey placeholders. The ⋯ button on a row opens rit./accel., renumbering, and move, loop, duplicate, repeat and delete.
- **Text** (left panel): the same map in a compact syntax (below). Both views edit the same piece.
- **Focus view**: the ⛶ button above the display (or F) shows only the click strip, fullscreen where the browser allows it. On tall (portrait) screens the strip wraps onto 2–3 rows, read like lines of text: the playhead is on the top row and each row continues where the one above ends (Settings → Focus view rows to fix the number). Corner buttons toggle the edge flash and mute. Tap anywhere to play or pause; Esc or the corner button leaves it.
- **Silent playback**: Settings → Visual beat flash → Screen edges lights the edges of the screen on every beat (brighter on downbeats), in any view; combine it with Mute clicks.
- **Display**: drag to move the start point, Ctrl/⌘+scroll or pinch to zoom, and tap it to continue from a pause.
- **Sections**: jump to a rehearsal mark, or loop it.
- **Keys**: Space play/pause/continue, Esc stop (or leave focus view), F focus view, ←/→ bar, [/] mark, L loop, −/+/0 tempo. Page-turner pedals (PgDn/↓/Enter) continue from pauses.

### Play together

The group button in the header creates or joins a room (a 5-character code, an invite link or a QR code). No accounts are needed.

- **One leader.** Whoever creates the room leads: their Play, Pause, Stop, tempo, loop, jump and pause-release control everyone. Followers' transport controls are locked. "Copy leader link" hands control to someone else.
- **Different maps are fine.** Each player plays their own map with their own count-in. Positions are shared as a rehearsal mark plus a bar offset (falling back to the bar number), so starting at B starts everyone at *their* B. Starting from the top starts every map at its first bar, at the same instant. The leader can also share their map with the room for others to load.
- **Pauses (fermatas)** are released by the leader: everyone continues a set delay (default 250 ms) after the leader's tap. A follower whose map pauses where the leader's doesn't can "Continue alone".
- **Countdown only.** Players using another metronome (or none) can join as "countdown only" and get a full-screen 3, 2, 1, GO with beeps that ends on the group's downbeat.
- **Late joiners** come in at the right place mid-piece.
- The bar above the display shows the room, the leader, who's present, and the clock-sync accuracy (e.g. "±4 ms").

How it works: every device syncs its clock to the server (NTP-style), and every command carries a future instant on that shared clock. Each device replays the room's command log against its own map and schedules the result on its audio clock. See [`docs/SYNC_PLAN.md`](docs/SYNC_PLAN.md) for the design and [`pocketbase/README.md`](pocketbase/README.md) to install the server.

### Text syntax

Separate entries with commas or new lines. Each entry is made of space-separated tokens:

| Token | Meaning |
|---|---|
| `A:` | rehearsal mark |
| `7/8`, `3+2+2/8` | metre, with optional grouping (6/8, 9/8, 12/8 group in threes automatically) |
| `c=120`, `q.=80`, `4=96` | tempo: `sb m c q sq ds hd` or `1 2 4 8 16 32 64`, with `.` for dotted |
| `x8` | number of bars (default 1) |
| `rit c=90`, `accel c=140`, `~c=90` | tempo glides across the block, ending at the target |
| `@17` | renumber: this block starts at bar 17 (`@0` for an upbeat) |
| `wait`, `wait 3s` | pause until tapped, or for a set time |
| `\|:` … `:\|`, `:\| x3` | repeat (played twice, or this many times in total) |
| `# Title`, `// comment` | title (first line) and comments |

```
# Example
A: c=120 4/4 x4
B: 3/4 x2, 5/8, 3+3+2/8 x2
|: C: q.=80 6/8 x4 :|
wait
D: c=96 7/8 x3, 4/4 x2 rit c=72
```

The v1 syntax is a subset of this one, so old maps still parse.

### Share links

The map is stored in the URL fragment, so it never reaches a server and links work on any static host. The address bar always holds the current map.

- `#m=…` holds the text syntax itself, lightly escaped (spaces become `_`, line breaks `;`) so links stay readable and hand-editable, e.g. `#m=A:_c=120_4/4_x8;B:_3+2/8_x4`.
- `#z=…` holds the text compressed with deflate-raw and base64url encoded. It's used automatically when it is at least 20% shorter, which only happens for long maps.
- Old `?sequence=` links from the v1 app (pako-compressed JSON) are decoded and converted.

The text syntax beat gzipped JSON on two counts. It is already compact: a typical map is shorter as text than its compressed JSON was. It also keeps one canonical format, so the URL, the text editor and saved maps are all the same thing. Compression uses the browser's built-in `CompressionStream`, so pako is no longer needed.

### Install and offline

The app is a Progressive Web App: open it in a browser and choose "Add to Home Screen" (iOS: Share → Add to Home Screen; Android: the install prompt or ⋮ → Install app). It then opens full screen with its own icon and works with no connection.

- `public/manifest.webmanifest` and the icons in `public/` make it installable. `scripts/icons.mjs` regenerates the icons (needs Playwright).
- `sw/sw.js` is the service worker. The `service-worker` plugin in `vite.config.ts` writes it into the build with the list of files to precache and a version derived from them, so each deploy replaces the old cache. Pages load network-first so updates arrive promptly, app files come from the cache, and other origins (the group-sync server) are left alone.

### Battery

- The display only redraws while something moves (playback, a drag, a fading flash) and briefly after any change, and at most ~60 times a second. A stopped metronome draws nothing.
- The AudioContext is suspended 5 s after playback stops and resumed on Play, unless the device is in a group, whose clock sync needs it running.
- In dark mode the focus view uses a true-black canvas, which costs almost nothing on OLED screens. The edge flash is a plain border that only changes opacity.

## Architecture

```
src/lib/model/       pure, tested, no DOM
  types.ts           Piece / Item (bars | pause | repeat) / Metre / Tempo
  music.ts           note values, tempo maths, default groupings
  syntax.ts          text syntax parser + canonical serialiser
  compile.ts         Piece -> Timeline: every click, bar and pause in score time
  share.ts           URL encode/decode (+ v1 legacy links)
  tree.ts            builder editing operations
src/lib/audio/
  transport.ts       pure mapping: AudioContext time -> score time
  worklet.ts         AudioWorklet: synthesises clicks on the audio thread
  engine.ts          main-thread owner of the AudioContext and transport state
  sounds.ts          sound settings
src/lib/display/
  renderer.ts        canvas rolling display
src/lib/sync/        group sync
  clock.ts           NTP-style clock offset estimation (pure)
  cues.ts            cue log -> transport state for this device's map (pure)
  room.ts            PocketBase API client
  session.ts         join links, saved session, constants (no PocketBase)
  group.svelte.ts    live session: presence, realtime cues, engine glue
src/lib/state/app.svelte.ts   app state (Svelte 5 runes)
src/lib/components/  UI
pocketbase/          sync server: migrations, hooks, local runner
```

### How audio and display stay in sync

1. `compile()` turns the piece into a **timeline**: arrays of click times in score time (seconds at 100% tempo), plus bar, pause and mark metadata. Rit./accel. are integrated exactly here (tempo is linear in beat position), so nothing downstream needs to know about them.
2. The **transport** is a small, pure, deterministic function from AudioContext time to score time. It is linear at `rate` (tempo %), stops at tap-holds, wraps at the loop end and stops at the piece's end. Every change (play, pause, tempo, loop, tap) is a new transport state stamped with an `anchorTime` slightly in the future, and the previous state stays in force until then.
3. The **AudioWorklet** runs on the audio rendering thread with a copy of the timeline and the transport state. For each 128-sample render quantum it asks the transport which stretch of score time the quantum covers, finds the clicks in it by binary search, and synthesises them at the exact sample. Main-thread jank cannot delay a click.
4. The **canvas** evaluates the same transport function at the time currently reaching the listener's ears (`getOutputTimestamp()`, falling back to `outputLatency`), plus an optional user calibration for Bluetooth and similar outputs. Both sides compute from identical data and agree on when each change takes effect, so they cannot drift apart.

Count-ins are a separate list of absolute-time clicks sent with the play command, so a count-in works from any start point in the piece. It uses the start bar's metre, grouping and tempo.

Group sync reuses this machinery unchanged. The room's cue log is reduced (by `sync/cues.ts`) to a transport state whose anchor times are on the server's clock; the device shifts those times onto its AudioContext clock via the clock-sync offset and `getOutputTimestamp()`, and hands the state to the engine (`Engine.adopt`). The mapping is re-checked every second and re-applied if it drifts by more than 3 ms.

This replaces v1's design, a worker that only posted "tick" timer messages to a main-thread scheduler. The new design keeps the audio on its own thread, as v1 intended, but now the clicks are generated there too.

## Docs

- [`docs/SYNC_PLAN.md`](docs/SYNC_PLAN.md): design of group sync, and the decisions taken.
- [`pocketbase/README.md`](pocketbase/README.md): installing and running the sync server.
- [`docs/IDEAS.md`](docs/IDEAS.md): possible future features.
