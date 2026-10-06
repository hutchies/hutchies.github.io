<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../state/app.svelte';
  import { LEVEL_COUNT_BAR, LEVEL_COUNT_BEAT } from '../model/compile';
  import {
    asynchronies,
    converged,
    estimateTaps,
    latencyMs,
    TARGET_ERROR_MS,
    usable,
    type TapEstimate,
  } from '../audio/latency';
  import Icon from './Icon.svelte';

  /**
   * Tap along with a 120 bpm click to measure how late this device's sound
   * is. Tapping also includes the touchscreen's lag and the player's own
   * habit of tapping early or late, so a one-off round of tapping to a silent
   * flash measures those, and is remembered (see audio/latency.ts). Each
   * round stops as soon as the average is pinned down.
   */
  let { onclose }: { onclose: () => void } = $props();

  /** Most beats in a round; it usually ends well before. */
  const MAX_BEATS = 24;
  /** Taps on the first beats are warm-up and don't count. */
  const WARMUP = 2;
  const PERIOD = 0.5;

  type Phase = 'intro' | 'audio' | 'between' | 'visual' | 'done';
  let phase = $state<Phase>('intro');
  let flashing = $state(false);
  /** Live precision while tapping. */
  let live = $state<TapEstimate | null>(null);
  let measureBias = $state(app.settings.tapBiasMs === null);
  let audio = $state<TapEstimate | null>(null);
  let bias = $state<number | null>(app.settings.tapBiasMs);
  let failed = $state<'audio' | 'visual' | null>(null);
  let error = $state('');

  let targets: number[] = []; // perf ms when each beat is heard / shown
  let taps: number[] = [];
  let finish: ((e: TapEstimate) => void) | null = null;
  let raf = 0;

  const busy = $derived(app.status !== 'stopped' && app.status !== 'paused');
  const result = $derived(audio && bias !== null ? latencyMs(audio, bias) : null);

  function current(): TapEstimate {
    return estimateTaps(asynchronies(taps, targets.slice(WARMUP)));
  }

  function tap(e: Event) {
    if (phase !== 'audio' && phase !== 'visual') return;
    e.preventDefault();
    taps.push(e.timeStamp);
    const est = current();
    live = est;
    if (converged(est)) finish?.(est);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') tap(e);
  }

  /** Runs one round over `targets`, resolving early once the estimate converges. */
  function round(): Promise<TapEstimate> {
    taps = [];
    live = null;
    return new Promise((resolve) => {
      const end = targets[targets.length - 1] + 600;
      const stop = (e: TapEstimate) => {
        finish = null;
        cancelAnimationFrame(raf);
        flashing = false;
        resolve(e);
      };
      finish = stop;
      const loop = () => {
        const now = performance.now();
        let k = 0;
        while (k < targets.length && targets[k] <= now) k++;
        flashing = phase === 'visual' && k > 0 && now - targets[k - 1] < 90;
        if (now > end) stop(current());
        else raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
  }

  async function start() {
    error = '';
    failed = null;
    audio = null;
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
    const times = Array.from({ length: MAX_BEATS }, (_, k) => t0 + k * PERIOD);
    app.engine.beeps(times, times.map((_, k) => (k % 4 === 0 ? LEVEL_COUNT_BAR : LEVEL_COUNT_BEAT)));
    targets = times.map((t) => app.engine.perfTimeHeardAt(t));
    phase = 'audio';
    const est = await round();
    app.engine.beeps([], []);
    app.persistSettings(); // restores the normal sound (and mute)
    if (!usable(est)) {
      failed = 'audio';
      phase = 'done';
      return;
    }
    audio = est;
    if (measureBias || bias === null) phase = 'between';
    else phase = 'done';
  }

  async function startVisual() {
    const t0 = performance.now() + 800;
    targets = Array.from({ length: MAX_BEATS }, (_, k) => t0 + k * PERIOD * 1000);
    phase = 'visual';
    const est = await round();
    if (!usable(est)) {
      failed = 'visual';
    } else {
      bias = Math.round(est.value);
      app.settings.tapBiasMs = bias;
      app.persistSettings();
      measureBias = false;
    }
    phase = 'done';
  }

  function apply() {
    if (result === null) return;
    app.settings.visualOffsetMs = Math.max(-150, Math.min(500, result));
    app.persistSettings();
    onclose();
  }

  function restart() {
    audio = null;
    failed = null;
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
      measures it: put on the headphones or speakers you'll play with, then tap the big button (or press Space) in time
      with the clicks you <em>hear</em>. It stops as soon as it has a steady reading, usually within 10 taps.
    </p>
    {#if bias === null}
      <p class="note">
        The first time, there's a second short round: tap with a silent flash. That measures your touchscreen's lag and
        your own habit of tapping a little early or late, so they can be taken out of the result. It's remembered, so
        next time (say, with different headphones) it's just the clicks.
      </p>
    {:else}
      <label class="check">
        <input type="checkbox" bind:checked={measureBias} />
        Also re-measure my tapping with the flash (new device, or a different person)
      </label>
    {/if}
    {#if busy}<p class="err">Stop playback first.</p>{/if}
    <button class="primary" onclick={start} disabled={busy}>Start</button>
    <p class="note">Current display delay: {app.settings.visualOffsetMs} ms.</p>
  {:else if phase === 'audio' || phase === 'visual'}
    <p class="what">
      {phase === 'audio' ? 'Tap with the clicks you hear' : 'Tap with the flash'}
      <span class="count">
        {#if live && live.count >= 3}±{Math.round(live.error)} ms{:else}…{/if}
      </span>
    </p>
    <button class="pad" class:flash={flashing} onpointerdown={tap} aria-label="Tap">
      <Icon name="tap" size={48} />
    </button>
    <p class="note">Keep going until it's steady (within ±{TARGET_ERROR_MS} ms).</p>
  {:else if phase === 'between'}
    <p>Got it. Now the one-off round: tap with the flash (no sound).</p>
    <button class="primary" onclick={startVisual}>Start</button>
  {:else if phase === 'done'}
    {#if failed}
      <p class="err">
        That wasn't steady enough to trust. Try again, tapping as evenly as you can{failed === 'audio' ? ' with the clicks you hear' : ' with the flash'}.
      </p>
      <button class="primary" onclick={restart}>Try again</button>
    {:else if result !== null}
      <p class="res">Your sound is about <strong>{result} ms</strong> behind the screen.</p>
      <p class="note">
        Setting the display delay to this lines the display up with what you hear and, in a group, starts your clicks
        that much earlier so they land with everyone else's.
      </p>
      <div class="row">
        <button class="primary" onclick={apply}>Use {result} ms</button>
        <button onclick={restart}>Measure again</button>
      </div>
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
  p {
    margin: 0;
  }
  .check {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.9rem;
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
