# Plan: group sync (PocketBase)

**Status: proposal, not implemented.** Please review the open questions at the end.

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

- **Endpoint:** a PocketBase JS hook (`pb_hooks/time.pb.js`) exposing `GET /api/time`, which returns the server's current time (`Date.now()`) in ms. This is a trivial route with no database access.
- **Client (`src/lib/sync/clock.ts`, pure and unit-testable):** NTP-style sampling.
  - Burst of 12 requests on join. For each: `t0 = performance.now()`, server `ts`, `t1 = performance.now()`.
  - Keep the ~4 samples with the lowest round-trip time (`t1 - t0`). The offset is `ts - (t0 + t1) / 2`, and the uncertainty is about half the best RTT.
  - Re-sample a few times every 30 s, and smooth with the median of recent best samples, to track drift between the device's clock and the server's.
- **Chain to audio time:** server ms → `performance.now()` via the offset → AudioContext time via `ctx.getOutputTimestamp()` (which pairs a `contextTime` with a `performanceTime`). Output latency is included, so the instant is when the click is *heard*. The existing per-device "display delay" calibration also applies to Bluetooth audio here.
- **Expected accuracy:** about ±2–10 ms over decent Wi-Fi or 4G to a nearby server. That's well under the ~20–30 ms at which ensemble players notice. If PocketBase runs on a laptop in the room (a single binary), LAN round trips are about 1–3 ms and accuracy is about ±1–2 ms.
- **UI:** each member shows a sync-quality badge (e.g. "±4 ms"), so a bad connection is visible before the downbeat.

## 2. Data model (PocketBase collections)

| Collection | Fields | Notes |
|---|---|---|
| `rooms` | `code` (text, unique, 5 chars like `K7QXM`), `name`, `hostKey` (hidden, hashed), `map` (text: the shared map in the text syntax, optional), `settings` (json: who may start, release mode), `expires` (date) | Joined by code or QR. No accounts needed. |
| `members` | `room` (rel), `clientId`, `displayName`, `part` (text), `lastSeen` (date), `rttMs`, `offsetErrMs`, `ready` (bool), `kind` (`app` \| `countdown`) | Presence via heartbeat every 10 s; stale after 30 s. |
| `cues` | `room` (rel), `seq` (number), `kind` (`start` \| `stop` \| `pause` \| `release` \| `tempo` \| `seek`), `at` (number: server ms when it takes effect), `payload` (json), `by` (clientId) | Append-only command log. Clients subscribe with PocketBase realtime (SSE), filtered by room. |

API rules (server-side):

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

## Open questions for you

1. **Hosting:** do you already run a PocketBase instance, or should this target a fresh one? (It affects the default server URL, and whether I write a `pb_migrations/` set and a deploy note, e.g. Fly.io or a small VPS.)
2. **Who controls playback:** a single leader with the host key (my default), or anyone in the room?
3. **Fermatas:** is leader-release with a small delay acceptable, or should "everyone taps" be the default?
4. **Accounts:** are anonymous rooms by code enough, or do you want persistent bands or groups with saved setlists? That would need PocketBase auth.
5. **Different maps:** is a sync point of "mark + bar offset / bar number" the right way to align players with different maps, or do you need named sync points defined in the syntax (e.g. `sync:intro`)?
