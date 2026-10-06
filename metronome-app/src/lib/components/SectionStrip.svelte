<script lang="ts">
  /**
   * The piece at a glance: one button per rehearsal-mark section, sized by
   * length. Tap a section to go there; tap the one you're in to loop it.
   * Without marks, falls back to the bar-by-bar overview.
   */
  import { app } from '../state/app.svelte';
  import Minimap from './Minimap.svelte';

  const tl = $derived(app.timeline);
  const dur = $derived(Math.max(tl.duration, 1e-6));

  const segs = $derived.by(() => {
    const bars = tl.bars;
    const out = app.sections.map((s) => ({ ...s }));
    // Bars before the first mark.
    if (out.length && out[0].from > 0) out.unshift({ label: '', from: 0, to: out[0].from - 1 });
    return out.map((s) => ({
      ...s,
      start: bars[s.from].start,
      end: bars[s.to].end,
      first: bars[s.from].number,
      last: bars[s.to].number,
    }));
  });

  const cur = $derived(tl.bars[app.currentBar]);

  function isLooped(s: { from: number; to: number }) {
    return app.loopOn && app.loopRange?.from === s.from && app.loopRange?.to === s.to;
  }

  function onTap(s: { from: number; to: number }) {
    const inside = app.currentBar >= s.from && app.currentBar <= s.to;
    if (inside && !app.following) {
      if (isLooped(s)) {
        // Clearing the range alone would leave the whole piece looping.
        app.loopOn = false;
        app.loopRange = null;
      }
      else app.loopSection(s.from, s.to);
    } else {
      app.seekBar(s.from);
    }
  }
</script>

{#if segs.length}
  <div class="strip">
    <div class="segs">
      {#each segs as s}
        {@const here = app.currentBar >= s.from && app.currentBar <= s.to}
        <button
          class="seg"
          class:here
          class:looped={isLooped(s)}
          style:flex-grow={(s.end - s.start) / dur}
          disabled={!app.canSeek && !here}
          onclick={() => onTap(s)}
          title={here
            ? isLooped(s)
              ? `Stop looping ${s.label || 'the opening'}`
              : `Loop ${s.label || 'the opening'} (bars ${s.first}–${s.last})`
            : `Go to ${s.label || 'the start'} (bar ${s.first})`}
        >
          <span class="lab">{s.label}</span>
          {#if isLooped(s)}<span class="lp">loop</span>{/if}
          {#if here && cur}
            <span class="pos" style:left="{((cur.start - s.start) / Math.max(1e-6, s.end - s.start)) * 100}%" aria-hidden="true"></span>
          {/if}
        </button>
      {/each}
    </div>
    <p class="hint">
      Tap a section to go there, and tap it again to loop it.
      {#if app.loopOn && !app.following}
        <button class="link" onclick={() => (app.loopOn = false)}>Stop looping</button>
      {/if}
    </p>
  </div>
{:else}
  <Minimap />
{/if}

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .segs {
    position: relative;
    display: flex;
    gap: 3px;
    height: 2.75rem;
  }
  .seg {
    flex-basis: 0;
    min-width: 1.6rem;
    border: none;
    border-radius: 8px;
    background: var(--c-surface-2);
    color: var(--c-muted);
    font-weight: 700;
    padding: 0;
    position: relative;
    overflow: visible;
  }
  .seg:hover:not(:disabled) {
    background: var(--c-border);
    color: var(--c-fg);
  }
  .seg.here {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .seg.looped {
    box-shadow: 0 0 0 2px var(--c-loop);
  }
  .lab {
    font-size: 1rem;
  }
  .lp {
    position: absolute;
    top: -0.55rem;
    right: 0.3rem;
    padding: 0 0.3rem;
    border-radius: 4px;
    background: var(--c-loop);
    color: var(--c-on-accent);
    font-size: 0.65rem;
    line-height: 1rem;
  }
  .pos {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 3px;
    margin-left: -1px;
    border-radius: 2px;
    background: var(--c-playhead);
    pointer-events: none;
  }
  .hint {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.82rem;
  }
  .hint .link {
    font-size: inherit;
    margin-left: 0.4rem;
  }
</style>
