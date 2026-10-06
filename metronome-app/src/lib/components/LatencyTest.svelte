<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../state/app.svelte';
  import { LEVEL_COUNT_BAR, LEVEL_COUNT_BEAT } from '../model/compile';
  import { asynchronies, latencyFromTaps, MAX_SPREAD_MS, type LatencyResult } from '../audio/latency';
  import Icon from './Icon.svelte';

  /**
   * Two short rounds at 120 bpm: tap along with clicks you hear, then with a
   * silent flash. The difference is how late this device's sound is (see
   * audio/latency.ts), and becomes the display delay setting.
   */
  let { onclose }: { onclose: () => void } = $props();

  const BEATS = 16;
  /** Taps on the first few beats are warm-up and don't count. */
  const WARMUP = 4;
  const PERIOD = 0.5;

  type Phase = 'intro' | 'audio' | 'between' | 'visual' | 'done';
  let phase = $state<Phase>('intro');
  let beat = $state(0);
  let flashing = $state(false);
  let result = $state<LatencyResult | null>(null);
  let error = $state('');

  let targets: number[] = []; // perf ms when each beat is heard / shown
  let taps: number[] = [];
  let audioTaps: number[] = [];
  let audioTargets: number[] = [];
  let raf = 0;

  const busy = $derived(app.status !== 'stopped' && app.status !== 'paused');

  function tap(e: Event) {
    if (phase !== 'audio' && phase !== 'visual') return;
    e.preventDefault();
    taps.push(e.timeStamp);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') tap(e);
  }

  async function startAudio() {
    error = '';
    try {
      await app.engine.start();
    } catch {
      error = 'Could not start audio.';
      return;
    }
    // Make sure the clicks are audible even if the metronome is muted.
    const sound = $state.snapshot(app.settings.sound);
    sound.volume = Math.max(sound.volume, 0.6);
    app.engine.setSound(sound);
    const t0 = app.engine.now + 0.8;
    const times = Array.from({ length: BEATS }, (_, k) => t0 + k * PERIOD);
    app.engine.beeps(times, times.map((_, k) => (k % 4 === 0 ? LEVEL_COUNT_BAR : LEVEL_COUNT_BEAT)));
    targets = times.map((t) => app.engine.perfTimeHeardAt(t));
    taps = [];
    phase = 'audio';
    run(() => {
      audioTaps = taps;
      audioTargets = targets;
      app.persistSettings(); // restores the normal sound (and mute)
      phase = 'between';
    });
  }

  function startVisual() {
    const t0 = performance.now() + 800;
    targets = Array.from({ length: BEATS }, (_, k) => t0 + k * PERIOD * 1000);
    taps = [];
    phase = 'visual';
    run(() => {
      result = latencyFromTaps(
        asynchronies(audioTaps, audioTargets.slice(WARMUP)),
        asynchronies(taps, targets.slice(WARMUP)),
      );
      phase = 'done';
    });
  }

  /** Follows the beats (progress and, in the visual round, the flash) until the round ends. */
  function run(done: () => void) {
    const end = targets[targets.length - 1] + 600;
    const loop = () => {
      const now = performance.now();
      let k = 0;
      while (k < targets.length && targets[k] <= now) k++;
      beat = k;
      flashing = phase === 'visual' && k > 0 && now - targets[k - 1] < 90;
      if (now > end) {
        flashing = false;
        done();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function apply() {
    if (!result) return;
    app.settings.visualOffsetMs = Math.max(-150, Math.min(500, result.offsetMs));
    app.persistSettings();
    onclose();
  }

  function restart() {
    result = null;
    phase = 'intro';
  }

  onDestroy(() => {
    cancelAnimationFrame(raf);
    if (phase === 'audio') {
      app.engine.beeps([], []);
      app.persistSettings();
    }
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="latency">
  {#if phase === 'intro'}
    <p>
      Wireless headphones and speakers play sound late, often by 150–300 ms, and most devices can't tell how late. This
      measures it in about 20 seconds.
    </p>
    <ol>
      <li>Put on the headphones or speakers you'll play with.</li>
      <li>Tap the big button (or press Space) in time with the clicks you <em>hear</em>.</li>
      <li>Then tap in time with a flash, with no sound. This cancels out your own timing and the touchscreen's lag.</li>
    </ol>
    {#if busy}<p class="err">Stop playback first.</p>{/if}
    <button class="primary" onclick={startAudio} disabled={busy}>Start</button>
    <p class="note">Current display delay: {app.settings.visualOffsetMs} ms.</p>
  {:else if phase === 'audio' || phase === 'visual'}
    <p class="what">
      {phase === 'audio' ? 'Tap with the clicks you hear' : 'Tap with the flash'}
      <span class="count">{Math.min(beat, BEATS)} / {BEATS}</span>
    </p>
    <button class="pad" class:flash={flashing} onpointerdown={tap} aria-label="Tap">
      <Icon name="tap" size={48} />
    </button>
  {:else if phase === 'between'}
    <p>Now the same again, but tap with the flash (no sound).</p>
    <button class="primary" onclick={startVisual}>Start round 2</button>
  {:else if phase === 'done' && result}
    {#if result.reliable}
      <p class="res">Your sound is about <strong>{result.offsetMs} ms</strong> behind the screen.</p>
      <p class="note">
        Setting the display delay to this lines the display up with what you hear and, in a group, starts your clicks
        that much earlier so they land with everyone else's.
      </p>
      <div class="row">
        <button class="primary" onclick={apply}>Use {result.offsetMs} ms</button>
        <button onclick={restart}>Measure again</button>
      </div>
    {:else}
      <p class="err">
        That wasn't steady enough to trust ({result.audio.count} and {result.visual.count} taps counted; the taps varied
        by {Math.round(Math.max(result.audio.spread, result.visual.spread))} ms, and need to be within {MAX_SPREAD_MS} ms).
        Try again, tapping as evenly as you can.
      </p>
      <button class="primary" onclick={restart}>Try again</button>
    {/if}
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .latency {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    align-items: flex-start;
  }
  p,
  ol {
    margin: 0;
  }
  ol {
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .what {
    font-weight: 700;
    font-size: 1.1rem;
    display: flex;
    gap: 1rem;
    width: 100%;
  }
  .count {
    margin-left: auto;
    color: var(--c-muted);
    font-variant-numeric: tabular-nums;
  }
  .pad {
    align-self: center;
    width: min(14rem, 60vw);
    height: min(14rem, 60vw);
    border-radius: 50%;
    border: 2px solid var(--c-border);
    background: var(--c-surface-2);
    touch-action: manipulation;
    transition: none;
  }
  .pad.flash {
    background: var(--c-playhead);
    border-color: var(--c-playhead);
    color: #fff;
  }
  .res {
    font-size: 1.15rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .note {
    font-size: 0.85rem;
    color: var(--c-muted);
  }
  .err {
    color: var(--c-danger);
  }
</style>
