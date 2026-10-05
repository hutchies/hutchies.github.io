<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { serialize } from '../model/syntax';
  import Icon from './Icon.svelte';

  let { onopen }: { onopen: () => void } = $props();

  const g = $derived(app.group!);
  /** Seconds until the next group start (null if none pending). */
  let startsIn = $state<number | null>(null);

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const p = g?.playback;
      let s: number | null = null;
      if (p?.mode === 'playing' && p.startAt !== null && g.phase === 'live') {
        const left = p.startAt - g.serverNow() / 1000;
        if (left > 0) s = Math.ceil(left * 10) / 10;
      }
      if (s !== startsIn) startsIn = s;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  const roomMapDiffers = $derived.by(() => {
    const m = g?.room?.map;
    if (!m || g.isLeader) return false;
    return m.trim() !== serialize(app.piece, { british: app.settings.british }).trim();
  });

  const leaderName = $derived(g?.leaderMember?.displayName || 'the leader');
  const players = $derived(g?.activeMembers.length ?? 0);
</script>

{#if g}
  <div class="bar" class:error={g.phase === 'error'}>
    <button class="room" onclick={onopen} title="Room details">
      <Icon name="group" size={18} />
      <span class="code">{g.code || '…'}</span>
    </button>
    {#if g.phase === 'connecting'}
      <span class="muted">Connecting…</span>
    {:else}
      <span class="role">{g.isLeader ? 'You lead' : `Following ${leaderName}`}</span>
      <span class="muted">{players} {players === 1 ? 'player' : 'players'}</span>
      {#if g.clock}
        <span class="sync" class:poor={g.clock.error > 15} title="Clock sync uncertainty (round trip {Math.round(g.clock.rtt)} ms)">
          ±{Math.max(1, Math.round(g.clock.error))} ms
        </span>
      {/if}
    {/if}
    {#if startsIn !== null}
      <span class="starts">Starting in {startsIn.toFixed(1)} s</span>
    {/if}
    <span class="spacer"></span>
    {#if g.audioBlocked}
      <button class="primary" onclick={() => app.engine.start()}><Icon name="sound" size={16} /> Enable sound</button>
    {/if}
    {#if roomMapDiffers}
      <button onclick={() => app.loadText(g.room!.map)} title="Replace your map with the one the leader shared">Load room map</button>
    {/if}
    {#if g.error}
      <span class="err" title={g.error}>{g.error}</span>
    {/if}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--c-border);
    border-radius: var(--radius);
    background: var(--c-surface);
    font-size: 0.9rem;
  }
  .bar.error {
    border-color: var(--c-danger);
  }
  .room {
    border: none;
    background: var(--c-surface-2);
    padding: 0.2rem 0.55rem;
  }
  .code {
    font-family: var(--mono);
    font-weight: 700;
    letter-spacing: 0.08em;
  }
  .role {
    font-weight: 600;
  }
  .muted {
    color: var(--c-muted);
  }
  .sync {
    font-variant-numeric: tabular-nums;
    color: var(--c-loop);
    font-weight: 600;
  }
  .sync.poor {
    color: var(--c-hold);
  }
  .starts {
    font-weight: 700;
    color: var(--c-countin);
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
  .err {
    color: var(--c-danger);
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
