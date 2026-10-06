<script lang="ts">
  /** Whole-piece overview: proportional strip of bars, marks and pauses. Click to set start point. */
  import { app } from '../state/app.svelte';
  import { metreToText } from '../model/music';
  import { barAt } from '../model/compile';

  const tl = $derived(app.timeline);
  // An indefinite ending is drawn as a short tail rather than its full horizon.
  const dur = $derived(Math.max(tl.open ? tl.openStart * 1.25 + 10 : tl.duration, 1e-6));

  // Merge consecutive bars of the same metre into segments for a cleaner strip.
  const segments = $derived.by(() => {
    const out: { from: number; to: number; start: number; end: number; metre: string }[] = [];
    for (const b of tl.bars) {
      const m = metreToText(b.metre);
      const last = out[out.length - 1];
      if (last && last.metre === m && Math.abs(last.end - b.start) < 1e-9 && !b.mark) {
        last.to = b.index;
        last.end = b.end;
      } else {
        out.push({ from: b.index, to: b.index, start: b.start, end: b.end, metre: m });
      }
    }
    return out;
  });

  // Stable colour per metre.
  const hue = (m: string) => {
    let h = 0;
    for (const c of m) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  };

  const cur = $derived(tl.bars[app.currentBar]);

  function onClick(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    app.seekBar(Math.max(0, barAt(tl, ((e.clientX - r.left) / r.width) * dur)));
  }
</script>

<div class="minimap" role="slider" aria-label="Piece overview" aria-valuemin={1} aria-valuemax={tl.bars.length} aria-valuenow={app.currentBar + 1} tabindex="-1" onclick={onClick} onkeydown={() => {}}>
  {#each segments as s}
    <div
      class="seg"
      style:left="{(s.start / dur) * 100}%"
      style:width="{((s.end - s.start) / dur) * 100}%"
      style:--h={hue(s.metre)}
      title="Bars {tl.bars[s.from].number}–{tl.bars[s.to].number}: {s.metre}"
    ></div>
  {/each}
  {#each tl.pauses as p}
    <div class="pause" class:tap={p.tap} style:left="{(p.time / dur) * 100}%" style:width="{(p.seconds / dur) * 100}%"></div>
  {/each}
  {#if app.loopRegion}
    <div
      class="loop"
      style:left="{(app.loopRegion.start / dur) * 100}%"
      style:width="{((app.loopRegion.end - app.loopRegion.start) / dur) * 100}%"
    ></div>
  {/if}
  {#each tl.marks as m}
    <div class="mark" style:left="{(m.time / dur) * 100}%">{m.label}</div>
  {/each}
  <div class="start" style:left="{(app.startPoint / dur) * 100}%" title="Start point"></div>
  {#if cur}
    <div class="cur" style:left="{(cur.start / dur) * 100}%" style:width="{((cur.end - cur.start) / dur) * 100}%"></div>
  {/if}
</div>

<style>
  .minimap {
    position: relative;
    height: 34px;
    border-radius: 8px;
    background: var(--c-surface-2);
    cursor: pointer;
    overflow: hidden;
    border: 1px solid var(--c-border);
    flex: none;
  }
  .seg {
    position: absolute;
    top: 14px;
    bottom: 0;
    background: hsl(var(--h) 55% var(--seg-l, 62%) / 0.55);
    border-left: 1px solid var(--c-canvas);
  }
  .pause {
    position: absolute;
    top: 14px;
    bottom: 0;
    min-width: 3px;
    background: var(--c-muted);
    opacity: 0.4;
  }
  .pause.tap {
    background: var(--c-hold);
    opacity: 1;
    width: 3px !important;
  }
  .loop {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--c-loop);
    opacity: 0.18;
    border-left: 2px solid var(--c-loop);
    border-right: 2px solid var(--c-loop);
  }
  .mark {
    position: absolute;
    top: 0;
    font-size: 11px;
    font-weight: 700;
    line-height: 13px;
    padding: 0 3px;
    border-left: 2px solid var(--c-fg);
    white-space: nowrap;
  }
  .start {
    position: absolute;
    top: 12px;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--c-accent);
  }
  .cur {
    position: absolute;
    top: 12px;
    bottom: 0;
    min-width: 3px;
    background: var(--c-playhead);
    opacity: 0.85;
  }
</style>
