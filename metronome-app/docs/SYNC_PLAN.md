# Plan: group sync (PocketBase)

**Status: implemented** (phases 1–4), with the decisions and changes listed under [What was built](#what-was-built) at the end. The server needs installing on hutchies.cc before the published app can use it: see [`pocketbase/README.md`](../pocketbase/README.md).

## Goal

Several players, each on their own device, start together, accurate to a few milliseconds, and stay together through tempo changes and pauses. Players may be:

- using this app with the **same map**,
- using this app with a **different map** (e.g. their own part, a different count-in, or starting from a different mark), or
- using **something else entirely**: another metronome app, a hardware click, or no click at all.

## The key idea: agree on an instant, not a message

Network messages arrive at different times on different devices, so "start when you receive this" can never be tight. Instead, every device agrees on a shared clock, and every command carries a **future instant on that clock** at which it takes effect.

The audio engine already works this way locally: every transport change is stamped with a future `anchorTime`, and the worklet and display both switch over at exactly that time. Group sync therefore only has to do two things:

1. convert a shared-clock instant into this device's AudioContext time, and
2. pass that time as the `anchorTime` of the change.

None of the playback code changes. The transport maths is pure and deterministic, so a device that joins late can also compute exactly where everyone else is and come in mid-piece.

## 1. Clock synchronisation

The server is the reference clock.

- **Endpoint:** a PocketBase JS hook (`pb_hooks/metronome.pb.js`) exposing `GET /api/metronome/time`, which returns the server's current time (`Date.now()`) in ms. This is a trivial route with no database access.
- **Client (`src/lib/sync/clock.ts`, pure and unit-testable):** NTP-style sampling.
  - Burst of 12 requests on join. For each: `t0 = performance.now()`, server `ts`, `t1 = performance.now()`.
  - Keep the ~4 samples with the lowest round-trip time (`t1 - t0`). The offset is `ts - (t0 + t1) / 2`, and the uncertainty is about half the best RTT.
  - Re-sample 4 times every 15 s, keeping the last 2 minutes of samples and taking the median of the best ones, to track drift between the device's clock and the server's.
- **Chain to audio time:** server ms → `performance.now()` via the offset → AudioContext time via `ctx.getOutputTimestamp()` (which pairs a `contextTime` with a `performanceTime`). Output latency is included, so the instant is when the click is *heard*. The existing per-device "display delay" calibration also applies to Bluetooth audio here.
- **Expected accuracy:** about ±2–10 ms over decent Wi-Fi or 4G to a nearby server. That's well under the ~20–30 ms at which ensemble players notice. If PocketBase runs on a laptop in the room (a single binary), LAN round trips are about 1–3 ms and accuracy is about ±1–2 ms.
- **UI:** each member shows a sync-quality badge (e.g. "±4 ms"), so a bad connection is visible before the downbeat.

## 2. Data model (PocketBase collections)

| Collection | Fields | Notes |
|---|---|---|
| `metronome_rooms` | `code` (text, unique, 5 chars like `K7QXM`), `name`, `hostKeyHash` (hidden), `map` (text: the shared map in the text syntax, optional), `settings` (json: `releaseLeadMs`), `expires` (date) | Joined by code or QR. No accounts needed. |
| `metronome_members` | `room` (rel), `clientId`, `keyHash` (hidden), `displayName`, `part` (text), `updated` (the heartbeat), `rttMs`, `offsetErrMs`, `countInSec`, `ready`, `leader` (bool), `kind` (`app`; `countdown` is no longer used) | Presence via heartbeat every 10 s; stale after 30 s. |
| `metronome_cues` | `room` (rel), `seq` (number), `kind` (`start` \| `stop` \| `pause` \| `release` \| `update` \| `seek` \| `room`), `at` (number: server ms when it takes effect), `payload` (json), `by` (clientId) | Append-only command log. Clients subscribe with PocketBase realtime (SSE), filtered by room. |

API rules (server-side; as proposed, see [What was built](#what-was-built) for what was implemented):

- Anyone with the room code can read the room, members and cues, and can create and update their own `members` row.
- Creating `cues` needs the host key, sent in a header and checked in a hook, unless room settings allow "anyone can start". A hook assigns `seq` and rejects an `at` too close to now or too far ahead.
- A cron hook deletes rooms, members and cues after `expires` (default 24 h).

## 3. Cue semantics

### Start

The payload is `{ syncPoint, tempoPercent, loop? }`. `at` is the instant of the **sync point's downbeat**, not the start of the count-in.

- `syncPoint` is a musical position everyone understands: a rehearsal mark plus a bar offset, or a bar number (`{ mark: "B" }` or `{ bar: 57 }`). Each device resolves it against **its own map**. A player whose part has a different map, or who wants a two-bar count-in instead of one, still lands on the same downbeat, because each device schedules its own count-in to end at `at`.
- The host sends `at = now + leadTime`. `leadTime` is the longest count-in in the room (members can report their count-in length) plus a network margin of about 1.5 s. Typically 3–6 s.
- **Late arrival:** if a device receives the cue after `at` (e.g. it reconnected), it computes the current position from the deterministic transport and comes in mid-piece, optionally on the next bar line.

### Tempo, seek, stop, pause

These are cues with `at = now + ~400 ms`. Every device re-anchors its transport at exactly that instant, as it does locally today.

### Tap-to-continue pauses (fermatas)

These are the hard case, because the release is a human gesture. There are two modes, chosen in room settings:

- **Leader releases:** the leader's tap sends `release` with `at = tap + δ`. δ is about 150–300 ms on the internet and about 30 ms on a LAN. Everyone, the leader included, continues at `at`. The cost is that the leader's own release is delayed by δ. Musically that is like a conductor's preparatory beat, and we could play an audible or visual "prep" click at `at − one beat` to make it feel natural.
- **Everyone taps:** each player releases themselves, as in a real ensemble following a conductor. There is no network dependency, but no guarantee of alignment either.

### Different metronomes (non-app players)

A member with `kind: "countdown"` gets a minimal full-screen view: a big visual countdown (3, 2, 1, GO) and an optional beep sequence ending exactly at `at`. That's enough for someone on a hardware metronome or another app to press start on "GO". For tighter results with an external metronome, that player can instead join as the leader, and everyone else syncs to the moment they press start in this app.

## 4. Client architecture

```
src/lib/sync/
  clock.ts      offset estimation (pure; unit tests with simulated jitter)
  room.ts       PocketBase SDK wrapper: create/join, presence heartbeat, cue subscription
  cues.ts       cue -> engine command translation (pure: given map + cue + clock -> TransportState)
src/lib/components/GroupPanel.svelte   create/join (code + QR), members list, ready check, leader controls
```

- `AppState` gets a `group` field. When in a room, Play, Stop, Tempo and Seek on the leader's device **publish cues** instead of acting locally. Every device, the leader's included, acts only when a cue arrives, so all devices take the same path and the leader has no special timing.
- `Engine.play()` gains an optional absolute `startAt` (AudioContext time), with the count-in scheduled to end exactly then. Other changes already take an anchor time, so they need only small adjustments.
- Dependency: the official `pocketbase` JS SDK (small, no other dependencies). The server URL is configurable in settings, defaulting to a hosted instance, so a band can point at their own laptop.

## 5. Phases

1. **Clock + start/stop.** Time endpoint, clock sync with quality display, rooms, presence, start and stop cues, late join. *This alone delivers "start together".*
2. **Live changes.** Tempo, seek and pause cues, leader-release for fermatas, ready check.
3. **Maps and parts.** Push the shared map to the room (one-tap "load the room's map"), per-member parts, leader handoff, countdown-only members.
4. **Rehearsal-room mode.** Docs and a script for running PocketBase on a laptop, plus QR join and LAN discovery hints.

## 6. Testing

- Unit tests: clock estimation against simulated asymmetric jitter; cue translation (same cue, different maps → correct local anchor times).
- Integration: two Playwright browser contexts in one room, with an analyser on each output, asserting the downbeat onsets are within a few ms of each other.
- Manual: two phones on different networks, recorded together with one microphone, measuring the offset in Audacity.

## Decisions

1. **Hosting:** the existing PocketBase at `https://hutchies.cc` (the app's default; configurable per device). Everything is prefixed `metronome_`: collections `metronome_rooms`, `metronome_members`, `metronome_cues`, routes under `/api/metronome/`, and the `metronome_cleanup` cron job.
2. **Control:** a single leader holding the room's host key.
3. **Fermatas:** leader releases.
4. **Accounts:** none; anonymous rooms joined by code.
5. **Different maps:** sync points are "mark + bar offset", falling back to the bar number. A start from the top is a start from every map's first bar, so the default is simply that everyone starts at the same instant with their own map.

## What was built

Mostly as proposed above. Where it differs:

- **Server.** Every write goes through custom routes in `pb_hooks/metronome.pb.js` that check the host key (or a per-member key) themselves, so all three collections are locked down. The one public rule lets a client read and subscribe to a room's cues if it sends the room code (`X-Room-Code`, which PocketBase also accepts as a realtime subscription option). The server assigns `seq` in a transaction, rejects `at` more than 60 s ahead, and moves an `at` that's already past to just ahead of now (rather than rejecting it), so every device still agrees on it. Rooms expire 24 h after their last use.
- **Presence** is a heartbeat every 10 s whose response is the member list (no realtime subscription on members). Members report their round trip, clock uncertainty and count-in length; the leader's start lead time is the longest count-in among present members plus `max(1.5 s, 3 × worst RTT + 0.5 s)`, at least 2.5 s.
- **Cue kinds:** `start`, `stop`, `pause`, `release`, `seek`, plus `update` (tempo and/or loop, replacing `tempo`) and `room` (no timing; tells clients to refetch the room after the leader shares a map or changes settings). Loops are shared as first/last-bar sync points, or "whole piece".
- **Replay, not incremental application.** Each device keeps the whole cue log and recomputes its transport by replaying it (`sync/cues.ts`) whenever a cue arrives, its map changes, or its count-in setting changes. This makes late joins, reconnects, out-of-order delivery and mid-piece map edits the same code path. The leader applies its own cues from the POST response rather than waiting for the realtime echo.
- **Engine.** Rather than `Engine.play()` gaining a `startAt`, the engine gained `adopt(state, countIn)`: the replayed transport state (shifted onto the AudioContext clock) is handed over whole. The worklet and display needed no changes.
- **Audio clock.** Server instants map to AudioContext time through the clock offset and `getOutputTimestamp()` (so the instant is when the click is heard), minus the display-delay calibration. The mapping is sampled every second (median of the last 5) and playback is re-anchored if it moves by more than 3 ms, which tracks drift between the audio clock and the system clock.
- **Releases** take effect `releaseLeadMs` after the leader's tap (250 ms by default, adjustable by the leader). A map that reaches its pause up to 0.5 s after the release continues straight on. A follower whose map pauses where the leader's doesn't would otherwise wait forever, so they get a "Continue alone" button (not bound to Space or pedals, to avoid accidents); it's kept as a local entry in that device's cue log.
- **Followers** can still move their own start point while stopped (it's replaced by the leader's next start), and keep their own count-in and display settings. Tempo, loop and transport controls are locked.
- **Reaching the end:** maps can differ in length, so each device stops when its own map ends.
- **Leader handoff** is a "leader link" carrying the host key in the URL fragment (never sent to a server). Host keys are remembered per device, so the leader can reload and still lead.
- **Not done:** the audible "prep" click before a release, LAN discovery, and the Playwright test with analysers on each output (see Testing).

### Revisions after first use

- **Leader sets the maps.** Projects can hold several parts (layered maps, see the README). In a room, the leader's whole project is synced to the room as they edit (debounced PATCH of the room's `map`), and the leader assigns each member a part, stored as `settings.assign` (client id → part name), so no schema change was needed. Followers load the room's project automatically, show their assigned part and solo it. Each device's transport is still driven by the part it shows; the other parts are layered on in the audio worklet with an offset that lines them up at the last start's sync point.
- **Countdown-only members removed.** Instead, every device shows a big countdown over the display until the downbeat, the room window closes for everyone when a start arrives, and the leader has Start/Pause/Stop in the room window. Players on another metronome can mute and play from the countdown.
- **Latency measurement.** A two-round tap test (tap with a 120 bpm click, then with a silent flash) sets the display delay to the difference, which cancels the player's own anticipation and the touchscreen's lag.
- **Latency test, round 2:** each round stops once the trimmed mean asynchrony is known to ±10 ms (95%, at least 6 taps; at most 24 beats, accepting ±20 ms). The flash round's result (the player's tapping bias: touchscreen lag plus anticipation) is saved as `tapBiasMs`, so later measurements are a single click round.
- **Restart after the end:** a start's lead-in used to report the previous run's position, so if that run had reached its end, the new start was parked as "finished". A start now parks everyone silently at the new start point until its downbeat.
- **Fixes:** don't sample the audio/server clock mapping before the first clock estimate (a late joiner could start seconds out until the drift check corrected it), and ignore output timestamps whose performance time is stale.

### Testing done

- Unit tests (`tests/sync.test.ts`): clock estimation under asymmetric jitter; sync points across different maps, repeats and loops; cue reduction (count-ins in different maps ending on the same downbeat, tempo/pause/stop instants, cancelled count-ins, releases including late-arriving maps, late join, out-of-order delivery).
- Server: the hooks and migration were run on PocketBase v0.40.4, and `tests/server.test.ts` exercises the API, permissions and the cue read rule (`METRONOME_PB_URL=… npm test`).
- Browser: four headless Chromium tabs against that local server (leader, a follower with a different map, a late joiner and a countdown-only member). Start from a mark, tempo change, pause, stop, fermata release, late join, leader link and rejoin after reload all behaved as designed; leader and follower positions agreed with the shared clock to within 0.1 ms. This was the same machine, so it checks the plumbing rather than network accuracy.
- Still to do: two phones on different networks, recorded with one microphone (section 6).
