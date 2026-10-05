<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { Renderer, type Frame, type Theme } from '../display/renderer';
  import { barAt, lowerBound, LEVEL_BAR, LEVEL_BEAT, LEVEL_COUNT_BAR, LEVEL_COUNT_BEAT } from '../model/compile';
  import { positionAt } from '../audio/transport';
  import Icon from './Icon.svelte';

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;

  // Readout (updated from the animation loop only when it changes).
  let barNumber = $state('1');
  let beatText = $state('');
  let beatCount = $state(0);
  let beatIndex = $state(-1);
  let markText = $state('');
  let flashOpacity = $state(0);
  let edgeOpacity = $state(0);
  let edgeStrong = $state(false);
  let canvasW = 0;
  let canvasH = 0;

  function readTheme(): Theme {
    const cs = getComputedStyle(wrap);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      bg: v('--c-canvas'),
      barShade: v('--c-canvas-shade'),
      fg: v('--c-fg'),
      muted: v('--c-muted'),
      beat: v('--c-beat'),
      pulse: v('--c-pulse'),
      accent: v('--c-accent'),
      playhead: v('--c-playhead'),
      loop: v('--c-loop'),
      countIn: v('--c-countin'),
      hold: v('--c-hold'),
    };
  }

  $effect(() => {
    void app.settings.theme;
    if (renderer) queueMicrotask(() => (renderer.theme = readTheme()));
  });

  let drag: { x: number; score: number; moved: boolean } | null = null;
  let lastScore = 0;
  let lastFrame: Frame | null = null;

  /** Rows for the focus view: wrap the strip so tall screens aren't one stretched lane. */
  function rows() {
    if (!app.focus) return 1;
    if (app.settings.focusRows > 0) return app.settings.focusRows;
    const n = Math.round((canvasH / Math.max(1, canvasW)) * 1.2);
    return Math.max(1, Math.min(3, n, Math.floor(canvasH / 180)));
  }

  function view() {
    return {
      pxPerSecond: app.settings.pxPerSecond,
      playhead: app.settings.playhead,
      showSubdivisions: app.settings.subdivide > 1,
      rows: rows(),
    };
  }

  function frame(): Frame {
    const eng = app.engine;
    const tl = app.timeline;
    const t = eng.audibleTime();
    const st = eng.state;
    const pos = positionAt(st, t);
    const rate = st.rate;
    let score = pos.score;
    let flash: Frame['flash'];
    let countInInfo: Frame['countIn'];
    const ci = eng.countIn;

    if (st.playing && ci && t < ci.startTime) {
      // Count-in: scroll the virtual position up to the start.
      score = ci.startScore - (ci.startTime - t) * ci.rate;
      let k = 0;
      while (k < ci.times.length && ci.times[k] <= t) k++;
      if (k > 0) flash = { age: t - ci.times[k - 1], level: ci.levels[k - 1] };
      countInInfo = {
        start: ci.startScore,
        offsets: ci.times.map((ct) => (ct - ci.startTime) * ci.rate),
        levels: ci.levels,
        remaining: k,
      };
      if (app.status !== 'countin') app.status = 'countin';
    } else if (st.playing && !pos.pending) {
      if (pos.frozen?.kind === 'end') {
        app.stop();
      } else if (pos.frozen?.kind === 'hold') {
        if (app.status !== 'held') app.status = 'held';
      } else if (app.status !== 'playing') {
        app.status = 'playing';
      }
      if (!pos.frozen) {
        const i = lowerBound(tl.clickTimes, score + 1e-9) - 1;
        if (i >= 0) flash = { age: (score - tl.clickTimes[i]) / rate, level: tl.clickLevels[i] };
      }
    }

    if (drag) score = lastScore;

    const highlight = app.selectedId && !app.focus ? app.barsForItem(app.selectedId) : null;
    return {
      score,
      flash,
      rate,
      loop: app.loopRegion,
      countIn: countInInfo,
      held: app.status === 'held',
      ended: false,
      highlight,
    };
  }

  function updateReadout(f: Frame) {
    const tl = app.timeline;
    if (!tl.bars.length) return;
    const bi = barAt(tl, Math.max(0, f.score));
    if (bi < 0) return;
    const bar = tl.bars[bi];
    if (app.currentBar !== bi && !f.countIn) app.currentBar = bi;
    let nb = String(bar.number);
    if (bar.pass) nb += ` (${bar.pass.n}/${bar.pass.of})`;
    if (barNumber !== nb) barNumber = nb;
    // Beat within bar: which group are we in?
    let beat = -1;
    if (f.countIn) {
      beat = -1;
    } else if (f.score >= bar.start - 1e-9) {
      const p = lowerBound(bar.pulses, f.score + 1e-9) - 1;
      let acc = 0;
      for (let g = 0; g < bar.groups.length; g++) {
        acc += bar.groups[g];
        if (p < acc) {
          beat = g;
          break;
        }
      }
    }
    if (beatIndex !== beat) beatIndex = beat;
    if (beatCount !== bar.groups.length) beatCount = bar.groups.length;
    const bt = f.countIn ? `count ${f.countIn.remaining}` : beat >= 0 ? `${beat + 1} / ${bar.groups.length}` : '';
    if (beatText !== bt) beatText = bt;
    // Most recent mark at or before this bar.
    let mk = '';
    for (const m of tl.marks) {
      if (m.barIndex <= bi) mk = m.label;
      else break;
    }
    if (markText !== mk) markText = mk;
    const lv = f.flash?.level;
    const strong = lv === LEVEL_BAR || lv === LEVEL_COUNT_BAR;
    const onBeat = strong || lv === LEVEL_BEAT || lv === LEVEL_COUNT_BEAT;
    const fo = app.settings.flash === 'display' && f.flash && strong ? Math.exp(-f.flash.age / 0.08) : 0;
    if (Math.abs(fo - flashOpacity) > 0.02) flashOpacity = fo;
    // Screen edges light up on every beat, brighter and wider on the downbeat.
    const eo = app.settings.flash === 'edges' && f.flash && onBeat ? Math.exp(-f.flash.age / (strong ? 0.16 : 0.11)) : 0;
    if (Math.abs(eo - edgeOpacity) > 0.02 || (eo === 0 && edgeOpacity !== 0)) edgeOpacity = eo;
    if (onBeat && edgeStrong !== strong) edgeStrong = strong;
  }

  onMount(() => {
    renderer = new Renderer(canvas, readTheme());
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      canvasW = r.width;
      canvasH = r.height;
      renderer.resize(r.width, r.height);
    });
    ro.observe(wrap);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => (renderer.theme = readTheme());
    mq.addEventListener('change', onScheme);

    let raf = 0;
    const loop = () => {
      const f = frame();
      if (!drag) lastScore = f.score;
      lastFrame = f;
      renderer.draw(app.timeline, f, view());
      updateReadout(f);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', onScheme);
    };
  });

  // Brief hint when entering the focus view.
  let showHint = $state(false);
  $effect(() => {
    if (!app.focus) return;
    showHint = true;
    const t = setTimeout(() => (showHint = false), 2500);
    return () => clearTimeout(t);
  });

  // Leaving browser fullscreen (Esc, system back gesture) also leaves the focus view.
  $effect(() => {
    const onFs = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      if (!d.fullscreenElement && !d.webkitFullscreenElement) app.setFocus(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  });

  function toggleEdges() {
    app.settings.flash = app.settings.flash === 'edges' ? 'off' : 'edges';
    app.persistSettings();
  }

  function canDrag() {
    return app.status === 'stopped' || app.status === 'paused';
  }

  function onPointerDown(e: PointerEvent) {
    if (app.status === 'held') {
      app.tap();
      return;
    }
    if (!canDrag()) {
      // In the focus view the whole strip is the play/pause button.
      if (app.focus) app.toggle();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, score: lastScore, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) {
      lastScore = Math.max(0, Math.min(app.timeline.duration, drag.score - dx / app.settings.pxPerSecond));
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const tl = app.timeline;
    let target: number;
    if (drag.moved) {
      target = lastScore;
    } else if (app.focus) {
      drag = null;
      app.toggle();
      return;
    } else {
      const rect = canvas.getBoundingClientRect();
      target = lastFrame ? renderer.scoreAtX(e.clientX - rect.left, lastFrame, view()) : lastScore;
    }
    drag = null;
    if (!tl.bars.length) return;
    // Snap to the nearest bar line.
    const i = barAt(tl, target);
    const bar = tl.bars[i];
    const snap = target - bar.start < bar.end - target || i === tl.bars.length - 1 ? i : i + 1;
    app.seekBar(Math.max(0, snap));
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.01);
      app.settings.pxPerSecond = Math.max(20, Math.min(800, app.settings.pxPerSecond * f));
      app.persistSettings();
    } else if (canDrag() && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      app.seekScore(lastScore + e.deltaX / app.settings.pxPerSecond);
    }
  }
</script>

{#if app.settings.flash === 'edges'}
  <div class="edges" class:strong={edgeStrong} style:opacity={edgeOpacity} aria-hidden="true"></div>
{/if}

<div class="display" class:held={app.status === 'held'} class:focus={app.focus}>
  <div class="readout" aria-live="off">
    <div class="cell">
      <span class="k">Bar</span>
      <span class="v">{barNumber}</span>
    </div>
    <div class="beats" aria-label="Beat {beatText}">
      {#each Array(Math.min(beatCount, 16)) as _, i}
        <span class="dot" class:on={i === beatIndex} class:first={i === 0}></span>
      {/each}
      <span class="bt">{beatText}</span>
    </div>
    {#if markText}
      <div class="cell mark"><span class="v">{markText}</span></div>
    {/if}
    <button class="icon small focus-btn" onclick={() => app.setFocus(true)} title="Focus view: just the click strip (F)" aria-label="Focus view">
      <Icon name="expand" size={18} />
    </button>
  </div>
  <div class="canvas-wrap" bind:this={wrap}>
    <canvas
      bind:this={canvas}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => (drag = null)}
      onwheel={onWheel}
      aria-label="Rolling beat display. Drag to move the start point; tap to continue from a pause."
    ></canvas>
    <div class="flash" style:opacity={flashOpacity * 0.45}></div>
    {#if app.focus}
      <div class="focus-tools">
        <button class="icon" class:on={app.settings.flash === 'edges'} aria-pressed={app.settings.flash === 'edges'} onclick={toggleEdges} title="Flash the screen edges on each beat" aria-label="Edge flash">
          <Icon name="edges" />
        </button>
        <button class="icon" class:on={app.settings.muted} aria-pressed={app.settings.muted} onclick={() => app.toggleMute()} title={app.settings.muted ? 'Unmute clicks' : 'Mute clicks'} aria-label="Mute">
          <Icon name={app.settings.muted ? 'muted' : 'sound'} />
        </button>
        <button class="icon" onclick={() => app.setFocus(false)} title="Leave focus view (Esc)" aria-label="Leave focus view">
          <Icon name="shrink" />
        </button>
      </div>
      <div class="hint" class:show={showHint}>Tap to play or pause · drag to move</div>
    {/if}
  </div>
</div>

<style>
  .display {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    flex: 1 0 auto;
    max-height: calc(min(440px, 55vh) + 3rem);
  }
  .readout {
    display: flex;
    align-items: center;
    gap: 0.5rem 1.25rem;
    padding: 0 0.25rem;
    min-height: 2.5rem;
    flex-wrap: wrap;
  }
  .focus-btn {
    margin-left: auto;
    color: var(--c-muted);
  }
  .cell {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .k {
    color: var(--c-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .v {
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .mark .v {
    border: 2px solid var(--c-fg);
    border-radius: 6px;
    padding: 0 0.5rem;
    font-size: 1.2rem;
  }
  .beats {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--c-surface-2);
    border: 1px solid var(--c-border);
    transition: background 60ms;
  }
  .dot.first {
    width: 18px;
    height: 18px;
  }
  .dot.on {
    background: var(--c-playhead);
    border-color: var(--c-playhead);
  }
  .bt {
    margin-left: 0.4rem;
    color: var(--c-muted);
    font-variant-numeric: tabular-nums;
    min-width: 4.5rem;
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-height: 200px;
    max-height: min(440px, 55vh);
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--c-border);
    background: var(--c-canvas);
  }
  .held .canvas-wrap {
    border-color: var(--c-hold);
    box-shadow: 0 0 0 2px var(--c-hold);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  @media (max-height: 500px) {
    .canvas-wrap {
      min-height: 150px;
    }
  }
  /* Focus view: the strip fills the whole screen. */
  .display.focus {
    position: fixed;
    inset: 0;
    z-index: 50;
    max-height: none;
    background: var(--c-canvas);
  }
  .focus .readout {
    display: none;
  }
  .focus .canvas-wrap {
    max-height: none;
    min-height: 0;
    border: none;
    border-radius: 0;
  }
  .focus.held .canvas-wrap {
    box-shadow: inset 0 0 0 4px var(--c-hold);
  }
  .focus-tools {
    position: absolute;
    top: max(0.5rem, env(safe-area-inset-top));
    right: max(0.5rem, env(safe-area-inset-right));
    display: flex;
    gap: 0.35rem;
  }
  .focus-tools button {
    opacity: 0.35;
    background: var(--c-surface-2);
  }
  .focus-tools button:hover,
  .focus-tools button:focus-visible {
    opacity: 1;
  }
  .focus-tools button.on {
    opacity: 0.8;
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  /* Beat cue around the edges of the screen, for silent playback. */
  .edges {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: none;
    box-shadow: inset 0 0 0 8px var(--c-accent), inset 0 0 28px 8px var(--c-accent);
  }
  .edges.strong {
    box-shadow: inset 0 0 0 14px var(--c-playhead), inset 0 0 44px 14px var(--c-playhead);
  }
  .hint {
    position: absolute;
    left: 50%;
    bottom: max(1.5rem, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    padding: 0.4rem 0.9rem;
    border-radius: 999px;
    background: var(--c-fg);
    color: var(--c-bg);
    font-size: 0.85rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 400ms;
  }
  .hint.show {
    opacity: 0.85;
  }
  .flash {
    position: absolute;
    inset: 0;
    background: var(--c-playhead);
    pointer-events: none;
    mix-blend-mode: normal;
  }
</style>
