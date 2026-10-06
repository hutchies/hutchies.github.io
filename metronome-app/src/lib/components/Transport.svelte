<script lang="ts">
  import { app } from '../state/app.svelte';
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';

  let showSpeed = $state(false);

  const playing = $derived(app.status === 'playing' || app.status === 'countin' || app.status === 'held');
  /** Following a group: the leader controls playback. */
  const locked = $derived(app.following);
  const lockedTitle = 'The leader controls playback';

  function countInValue() {
    const c = app.settings.countIn;
    return c.amount === 0 ? '0' : `${c.amount}${c.unit === 'bars' ? 'b' : 'q'}`;
  }

  function setCountIn(v: string) {
    if (v === '0') app.settings.countIn = { amount: 0, unit: 'bars' };
    else app.settings.countIn = { amount: Number(v.slice(0, -1)), unit: v.endsWith('b') ? 'bars' : 'beats' };
    app.persistSettings();
  }

  const countInText = $derived.by(() => {
    const c = app.settings.countIn;
    if (c.amount === 0) return 'no count-in';
    const unit = c.unit === 'bars' ? 'bar' : 'beat';
    return `${c.amount} ${unit}${c.amount > 1 ? 's' : ''} count-in`;
  });

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

<div class="transport" class:locked>
  <div class="group main">
    <button class="round" onclick={() => app.stop()} disabled={locked} title={locked ? lockedTitle : 'Stop and go back to the start point (Esc)'} aria-label="Stop">
      <Icon name="stop" />
    </button>
    {#if app.status === 'held'}
      <button
        class="play tap"
        onclick={() => (locked ? app.continueAlone() : app.tap())}
        title={locked
          ? "Waiting for the leader. Tap to continue on your own (if your map pauses where the leader's doesn't)"
          : app.leading
            ? 'Continue, for everyone (Space, or tap the display)'
            : 'Continue (Space, or tap the display)'}
      >
        <Icon name="tap" size={26} /> <span>{locked ? 'Continue alone' : 'Tap'}</span>
      </button>
    {:else}
      <button
        class="play"
        class:active={playing}
        onclick={() => app.toggle()}
        disabled={locked}
        title={locked ? lockedTitle : app.leading ? 'Play / pause for everyone (Space)' : 'Play / pause (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={30} />
      </button>
    {/if}
    <button
      class="toggle"
      class:on={app.loopOn}
      onclick={() => (app.loopOn = !app.loopOn)}
      disabled={locked}
      title={locked ? lockedTitle : 'Loop (L)'}
      aria-pressed={app.loopOn}
    >
      <Icon name="loop" size={18} /> {loopLabel}
    </button>
  </div>

  <button class="speed" onclick={() => (showSpeed = true)} title="Tempo and count-in">
    Speed {app.tempoPercent}% · {countInText}
  </button>
</div>

<Dialog bind:open={showSpeed} title="Speed">
  <div class="speedform">
    <div class="tempo">
      <label for="tempo-range" class="lbl">Tempo</label>
      <button class="icon small" onclick={() => app.setTempoPercent(app.settings.tempoPercent - 5)} disabled={locked} aria-label="Slower">
        <Icon name="minus" size={16} />
      </button>
      <input
        id="tempo-range"
        type="range"
        min="25"
        max="200"
        step="1"
        value={app.tempoPercent}
        disabled={locked}
        oninput={(e) => app.setTempoPercent(Number(e.currentTarget.value))}
      />
      <button class="icon small" onclick={() => app.setTempoPercent(app.settings.tempoPercent + 5)} disabled={locked} aria-label="Faster">
        <Icon name="plus" size={16} />
      </button>
      <button class="pct" onclick={() => app.setTempoPercent(100)} disabled={locked} title={locked ? "The leader's tempo" : 'Reset to 100%'}>
        {app.tempoPercent}%
      </button>
    </div>
    {#if locked}<p class="note">The leader sets the tempo.</p>{/if}
    <div class="tempo">
      <label for="countin" class="lbl">Count-in</label>
      <select id="countin" value={countInValue()} onchange={(e) => setCountIn(e.currentTarget.value)}>
        <option value="0">None</option>
        <option value="1q">1 beat</option>
        <option value="2q">2 beats</option>
        <option value="3q">3 beats</option>
        <option value="4q">4 beats</option>
        <option value="1b">1 bar</option>
        <option value="2b">2 bars</option>
        <option value="3b">3 bars</option>
        <option value="4b">4 bars</option>
      </select>
    </div>
    <p class="note">Keys: − and + change the tempo by 5%, 0 resets it.</p>
  </div>
</Dialog>

<style>
  .transport {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.75rem 1.25rem;
  }
  .main {
    gap: 0.9rem;
  }
  .round {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .toggle {
    border-radius: 999px;
    padding: 0.5rem 0.9rem;
  }
  .speed {
    border-radius: 999px;
    padding: 0.5rem 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .speedform {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .tempo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .tempo .lbl {
    min-width: 5rem;
  }
  .tempo input {
    flex: 1;
    min-width: 80px;
  }
  .note {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.85rem;
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
  @media (max-width: 600px) {
    .transport {
      gap: 0.6rem;
    }
    .main {
      width: 100%;
      justify-content: center;
    }
  }
</style>
