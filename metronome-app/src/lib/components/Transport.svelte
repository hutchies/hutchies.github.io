<script lang="ts">
  import { app } from '../state/app.svelte';
  import Icon from './Icon.svelte';

  const playing = $derived(app.status === 'playing' || app.status === 'countin' || app.status === 'held');

  function countInValue() {
    const c = app.settings.countIn;
    return c.amount === 0 ? '0' : `${c.amount}${c.unit === 'bars' ? 'b' : 'q'}`;
  }

  function setCountIn(v: string) {
    if (v === '0') app.settings.countIn = { amount: 0, unit: 'bars' };
    else app.settings.countIn = { amount: Number(v.slice(0, -1)), unit: v.endsWith('b') ? 'bars' : 'beats' };
    app.persistSettings();
  }

  const loopLabel = $derived.by(() => {
    if (!app.loopOn) return 'Loop';
    const r = app.loopRange;
    const bars = app.timeline.bars;
    if (!r || !bars.length) return 'Loop: all';
    const a = bars[Math.min(r.from, bars.length - 1)];
    const b = bars[Math.min(r.to, bars.length - 1)];
    return `Loop: ${a.number}–${b.number}`;
  });
</script>

<div class="transport">
  <div class="group main">
    <button class="icon" onclick={() => app.stop()} title="Stop and return to start point (Esc)" aria-label="Stop">
      <Icon name="stop" />
    </button>
    <button class="icon" onclick={() => app.stepMark(-1)} title="Previous mark ([)" aria-label="Previous mark">
      <Icon name="prev" />
    </button>
    {#if app.status === 'held'}
      <button class="play tap" onclick={() => app.tap()} title="Continue (Space, or tap the display)">
        <Icon name="tap" size={26} /> <span>Tap</span>
      </button>
    {:else}
      <button
        class="play"
        class:active={playing}
        onclick={() => app.toggle()}
        title="Play / pause (Space)"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={30} />
      </button>
    {/if}
    <button class="icon" onclick={() => app.stepMark(1)} title="Next mark (])" aria-label="Next mark">
      <Icon name="next" />
    </button>
    <button
      class="toggle"
      class:on={app.loopOn}
      onclick={() => (app.loopOn = !app.loopOn)}
      title="Loop (L)"
      aria-pressed={app.loopOn}
    >
      <Icon name="loop" size={18} /> {loopLabel}
    </button>
  </div>

  <div class="group tempo">
    <label for="tempo-range" class="lbl">Tempo</label>
    <button class="icon small" onclick={() => app.setTempoPercent(app.settings.tempoPercent - 5)} aria-label="Slower">
      <Icon name="minus" size={16} />
    </button>
    <input
      id="tempo-range"
      type="range"
      min="25"
      max="200"
      step="1"
      value={app.settings.tempoPercent}
      oninput={(e) => app.setTempoPercent(Number(e.currentTarget.value))}
    />
    <button class="icon small" onclick={() => app.setTempoPercent(app.settings.tempoPercent + 5)} aria-label="Faster">
      <Icon name="plus" size={16} />
    </button>
    <button class="pct" onclick={() => app.setTempoPercent(100)} title="Reset to 100%">
      {app.settings.tempoPercent}%
    </button>
  </div>

  <div class="group countin">
    <label for="countin" class="sr">Count-in</label>
    <select id="countin" value={countInValue()} onchange={(e) => setCountIn(e.currentTarget.value)}>
      <option value="0">No count-in</option>
      <option value="1q">Count-in: 1 beat</option>
      <option value="2q">Count-in: 2 beats</option>
      <option value="3q">Count-in: 3 beats</option>
      <option value="4q">Count-in: 4 beats</option>
      <option value="1b">Count-in: 1 bar</option>
      <option value="2b">Count-in: 2 bars</option>
      <option value="3b">Count-in: 3 bars</option>
      <option value="4b">Count-in: 4 bars</option>
    </select>
  </div>
</div>

<style>
  .transport {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.5rem;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .lbl {
    color: var(--c-muted);
    font-size: 0.85rem;
  }
  .play {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--c-accent);
    color: var(--c-on-accent);
    border: none;
    display: grid;
    place-items: center;
    box-shadow: var(--shadow);
  }
  .play.active {
    background: var(--c-fg);
    color: var(--c-bg);
  }
  .play.tap {
    background: var(--c-hold);
    color: #fff;
    width: auto;
    padding: 0 1.2rem;
    border-radius: 32px;
    display: flex;
    gap: 0.4rem;
    font-weight: 700;
    font-size: 1.1rem;
    animation: pulse 0.9s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      transform: scale(1.06);
    }
  }
  .pct {
    min-width: 4rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .tempo input {
    width: 140px;
  }
  @media (max-width: 600px) {
    .transport {
      justify-content: center;
      gap: 0.5rem 0.75rem;
    }
    .main {
      width: 100%;
      justify-content: center;
    }
    .tempo {
      flex: 1;
      min-width: 0;
    }
    .tempo .lbl {
      display: none;
    }
    .tempo input {
      flex: 1;
      min-width: 60px;
      width: auto;
    }
    .pct {
      min-width: 3.4rem;
      padding: 0.3rem 0.4rem;
    }
  }
</style>
