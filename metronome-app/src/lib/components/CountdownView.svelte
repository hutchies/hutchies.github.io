<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { COUNTDOWN_SECONDS } from '../sync/session';
  import Icon from './Icon.svelte';

  /**
   * Full-screen view for players using another metronome (or none): a big
   * 3, 2, 1, GO (with beeps) that lands exactly on the group's start.
   */
  let { onopen }: { onopen: () => void } = $props();

  const g = $derived(app.group!);
  let big = $state('');
  let small = $state('Waiting for the leader to start');
  let go = $state(false);
  /** More than COUNTDOWN_SECONDS to go: the number is shown, but muted. */
  let far = $state(false);

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const at = g?.countdownAt;
      let b = '';
      let s = 'Waiting for the leader to start';
      let isGo = false;
      let isFar = false;
      if (at !== null && at !== undefined && g.phase === 'live') {
        const left = (at - g.serverNow()) / 1000;
        if (left > COUNTDOWN_SECONDS) {
          b = String(Math.ceil(left));
          s = 'Starting soon';
          isFar = true;
        } else if (left > 0) {
          b = String(Math.ceil(left));
          s = 'Get ready';
        } else if (left > -2) {
          b = 'GO';
          s = '';
          isGo = true;
        } else {
          s = 'Playing';
        }
      }
      if (b !== big) big = b;
      if (s !== small) small = s;
      if (isGo !== go) go = isGo;
      if (isFar !== far) far = isFar;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="countdown" class:go>
  <header>
    <span class="code">{g?.code}</span>
    <span class="spacer"></span>
    {#if g?.clock}<span class="sync">±{Math.max(1, Math.round(g.clock.error))} ms</span>{/if}
    <button class="icon" onclick={onopen} aria-label="Room details"><Icon name="group" /></button>
  </header>
  <div class="big" class:far>{big}</div>
  <div class="small">{small}</div>
  {#if g?.audioBlocked}
    <button class="primary" onclick={() => app.engine.start()}><Icon name="sound" size={16} /> Enable beeps</button>
  {/if}
  {#if g?.isLeader}
    <div class="lead">
      <button class="primary" onclick={() => app.play()}>Start everyone</button>
      <button onclick={() => app.stop()}>Stop</button>
    </div>
  {/if}
  {#if g?.error}<p class="err">{g.error}</p>{/if}
</div>

<style>
  .countdown {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: var(--c-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
  }
  .countdown.go {
    background: var(--c-loop);
    color: #fff;
  }
  header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
  }
  .spacer {
    flex: 1;
  }
  .code {
    font-family: var(--mono);
    font-weight: 700;
    letter-spacing: 0.1em;
  }
  .sync {
    font-variant-numeric: tabular-nums;
    color: var(--c-muted);
  }
  .big {
    font-size: min(40vw, 40vh);
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    min-height: 1em;
  }
  .big.far {
    color: var(--c-muted);
    opacity: 0.4;
  }
  .small {
    font-size: 1.4rem;
    color: var(--c-muted);
  }
  .go .small {
    color: inherit;
  }
  .lead {
    display: flex;
    gap: 0.75rem;
  }
  .lead button {
    font-size: 1.2rem;
    padding: 0.6rem 1.2rem;
  }
  .err {
    color: var(--c-danger);
  }
</style>
