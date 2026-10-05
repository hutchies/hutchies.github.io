# Metronome

A metronome for complex, multi-metre music. You build a map of a piece: bars, metres (including additive ones like 3+2+2/8), tempi, rit./accel., pauses and repeats. You can share the whole map as a link and play it back with a sample-accurate audio engine and a rolling display that stays exactly in sync with the audio.

Built with Svelte 5, TypeScript and Vite. It has no runtime dependencies and no backend.

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (parser, compiler, transport maths, URL codec)
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
- **Focus view**: the ⛶ button above the display (or F) shows only the click strip, fullscreen where the browser allows it. Tap anywhere to play or pause; Esc or the corner button leaves it.
- **Display**: drag to move the start point, Ctrl/⌘+scroll or pinch to zoom, and tap it to continue from a pause.
- **Sections**: jump to a rehearsal mark, or loop it.
- **Keys**: Space play/pause/continue, Esc stop (or leave focus view), F focus view, ←/→ bar, [/] mark, L loop, −/+/0 tempo. Page-turner pedals (PgDn/↓/Enter) continue from pauses.

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
src/lib/state/app.svelte.ts   app state (Svelte 5 runes)
src/lib/components/  UI
```

### How audio and display stay in sync

1. `compile()` turns the piece into a **timeline**: arrays of click times in score time (seconds at 100% tempo), plus bar, pause and mark metadata. Rit./accel. are integrated exactly here (tempo is linear in beat position), so nothing downstream needs to know about them.
2. The **transport** is a small, pure, deterministic function from AudioContext time to score time. It is linear at `rate` (tempo %), stops at tap-holds, wraps at the loop end and stops at the piece's end. Every change (play, pause, tempo, loop, tap) is a new transport state stamped with an `anchorTime` slightly in the future, and the previous state stays in force until then.
3. The **AudioWorklet** runs on the audio rendering thread with a copy of the timeline and the transport state. For each 128-sample render quantum it asks the transport which stretch of score time the quantum covers, finds the clicks in it by binary search, and synthesises them at the exact sample. Main-thread jank cannot delay a click.
4. The **canvas** evaluates the same transport function at the time currently reaching the listener's ears (`getOutputTimestamp()`, falling back to `outputLatency`), plus an optional user calibration for Bluetooth and similar outputs. Both sides compute from identical data and agree on when each change takes effect, so they cannot drift apart.

Count-ins are a separate list of absolute-time clicks sent with the play command, so a count-in works from any start point in the piece. It uses the start bar's metre, grouping and tempo.

This replaces v1's design, a worker that only posted "tick" timer messages to a main-thread scheduler. The new design keeps the audio on its own thread, as v1 intended, but now the clicks are generated there too.

## Docs

- [`docs/SYNC_PLAN.md`](docs/SYNC_PLAN.md): proposed design for starting in sync with other players (PocketBase), awaiting approval.
- [`docs/IDEAS.md`](docs/IDEAS.md): possible future features.
