# Feature ideas

These are possible additions, grouped roughly by theme. Items marked ★ would be cheap with the current architecture.

## Practice tools

- ★ **Tempo trainer:** raise the tempo by N% after each loop pass (or every N bars) up to a target, or drop back after a mistake.
- ★ **Gap / silence training:** mute random bars, or every Nth bar, so you hold the pulse yourself and check whether you are still in time when the click returns.
- **Tap tempo / tap a structure:** tap a passage to measure its tempo, or tap along to a recording to generate a map with rit./accel. automatically.
- **Accuracy feedback:** listen through the microphone (or to a MIDI input) and show how early or late each note is against the click.
- ★ **Practice log:** time spent per piece and section, plus tempo progress over days (local storage).
- ★ **Per-section tempo overrides** for practice ("play B at 80%") without editing the map.

## Sound

- **Spoken counting** ("one, two, three…", or "one-and-two" for subdivisions). v1 did this with meSpeak; recorded samples per number would be better and lighter.
- ★ **Per-block accent patterns,** e.g. `accent:1,4,6`, or silence on some beats.
- ★ **Polyrhythms and cross-rhythms:** a second click layer (3 against 4, 5 against 4) with its own sound.
- **Swing / shuffle feel** for subdivisions.
- **Sample-based sounds** (claves, cowbell, rimshot), or loading your own samples.
- **Pan / channel routing:** the click on one ear only, or a separate output for in-ear monitors.
- **MIDI clock out** (Web MIDI) to drive DAWs, drum machines or lighting desks.

## Notation and structure

- ★ **First and second endings / voltas** (`|1.` `|2.`), plus D.S., D.C., Coda and Fine.
- **Tempo equations / metric modulation,** e.g. `q=q.` (the new dotted crotchet equals the old crotchet). Common in contemporary music.
- **Ritardando curve shapes:** linear in time vs linear in beats vs exponential, chosen per glide.
- **Fermata on a specific beat** (not just between bars), with a tap or timed release.
- **Cue lines / text annotations** on the timeline ("Tutti", "Solo vn"), shown as they approach.
- **Multiple parts per piece** (e.g. a percussionist's map with different bar groupings), aligned to shared sync points. This ties in with group sync.
- **Import** from MusicXML or MIDI tempo maps, so a map can be pulled straight from a score or DAW session.
- **Export** to a click-track WAV or MIDI file, for recording sessions or players without the app.

## Display

- **Vertical scrolling mode,** for a phone or tablet on a music stand.
- **Conductor view:** a beat-pattern animation (downbeat, then left/right/up) that adapts to irregular groupings.
- ★ **Large "next change" warning:** "7/8 in 2 bars" or "rit. coming", shown before metre or tempo changes.
- ★ **Full-screen performance mode** with only the readout and big beat dots, for use at a distance.
- **Show the current block's text** above the canvas, or a small score-like strip with time signatures and marks only.
- ★ **Colour-coding by metre or section** inside the canvas (the minimap already does this).

## Sharing and storage

- ★ **QR code** for the share link (useful in rehearsals).
- **Setlists:** an ordered list of maps with one-tap advance, shareable as a single link.
- **Cloud library** (PocketBase again) with versioning, for ensembles that share maps.
- **Installable PWA** with offline support (a service worker plus manifest). The app is already fully static, so this is mostly packaging.

## Input and control

- **Foot-pedal / MIDI controller mapping** for play, continue and next section (key-sending page turners already work).
- **Remote control:** a second device in the same room acts as the transport (needs group sync).
- **Vibration / haptic beats** on phones (`navigator.vibrate`, Android only), for silent practice.
- **Apple Watch / wearables** via a companion app (a larger project).
