<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { Item, Metre, NoteValue, Tempo } from '../model/types';
  import { metreToText, formatNumber, tempoToText, wholesPerSecond, convertTempo } from '../model/music';
  import { parseMetre } from '../model/syntax';
  import * as tree from '../model/tree';
  import Icon from './Icon.svelte';
  import ItemCard from './ItemCard.svelte';

  let { item }: { item: Item } = $props();

  const UNITS: { v: NoteValue; sym: string; uk: string; us: string }[] = [
    { v: { base: 1, dots: 0 }, sym: '𝅝', uk: 'semibreve', us: 'whole' },
    { v: { base: 2, dots: 1 }, sym: '𝅗𝅥.', uk: 'dotted minim', us: 'dotted half' },
    { v: { base: 2, dots: 0 }, sym: '𝅗𝅥', uk: 'minim', us: 'half' },
    { v: { base: 4, dots: 1 }, sym: '♩.', uk: 'dotted crotchet', us: 'dotted quarter' },
    { v: { base: 4, dots: 0 }, sym: '♩', uk: 'crotchet', us: 'quarter' },
    { v: { base: 8, dots: 1 }, sym: '♪.', uk: 'dotted quaver', us: 'dotted eighth' },
    { v: { base: 8, dots: 0 }, sym: '♪', uk: 'quaver', us: 'eighth' },
    { v: { base: 16, dots: 0 }, sym: '𝅘𝅥𝅯', uk: 'semiquaver', us: 'sixteenth' },
  ];
  const unitKey = (v: NoteValue) => `${v.base}.${v.dots}`;
  const unitLabel = (u: (typeof UNITS)[number]) => `${u.sym} ${app.settings.british ? u.uk : u.us}`;
  const unitSym = (v: NoteValue) => UNITS.find((u) => unitKey(u.v) === unitKey(v))?.sym ?? '♩';

  const range = $derived(app.barsForItem(item.id));
  const firstBar = $derived(range ? app.timeline.bars[range.from] : undefined);
  // Bar numbers covered by the first pass, e.g. [5, 8].
  const span = $derived.by(() => {
    if (!range) return null;
    const bars = app.timeline.bars;
    let last = range.from;
    while (last + 1 <= range.to && bars[last + 1].number > bars[last].number) last++;
    return [bars[range.from].number, bars[last].number] as const;
  });
  const forever = $derived(item.kind === 'bars' && !!item.forever);
  const rangeText = $derived(
    !span ? '' : forever ? `From bar ${span[0]}, indefinitely` : span[0] === span[1] ? `Bar ${span[0]}` : `Bars ${span[0]}–${span[1]}`,
  );
  const shortRange = $derived(!span ? '' : forever ? `${span[0]}–∞` : span[0] === span[1] ? `${span[0]}` : `${span[0]}–${span[1]}`);

  function setForever(on: boolean) {
    if (item.kind !== 'bars') return;
    if (on) {
      item.forever = true;
      // An indefinite block holds its tempo.
      delete item.tempoTo;
    } else delete item.forever;
  }

  /** The × field takes a number of bars, or ∞ (also "inf", "*", "forever") for indefinitely. */
  function setCount(v: string) {
    if (item.kind !== 'bars') return;
    const t = v.trim().toLowerCase();
    if (/^(∞|\*|i|in|inf|infinite|indef.*|f|for|forever)$/.test(t)) setForever(true);
    else if (/^\d+$/.test(t) && Number(t) >= 1) {
      setForever(false);
      item.bars = Math.min(999, Number(t));
    }
  }
  /** Extra options and actions, shown on demand to keep the list compact. */
  let open = $state(false);
  const selected = $derived(app.selectedId === item.id);
  const playingHere = $derived(
    !!range && app.status !== 'stopped' && app.currentBar >= range.from && app.currentBar <= range.to,
  );

  // Inherited context for placeholders.
  const effMetre = $derived<Metre | undefined>(firstBar?.metre);
  const effTempo = $derived<Tempo | undefined>(firstBar?.tempoStart);

  let metreText = $state('');
  let metreBad = $state(false);
  $effect(() => {
    if (item.kind === 'bars') metreText = item.metre ? metreToText(item.metre) : '';
  });

  function setMetre(v: string) {
    if (item.kind !== 'bars') return;
    const t = v.trim();
    if (!t) {
      delete item.metre;
      metreBad = false;
      return;
    }
    const m = parseMetre(t);
    metreBad = !m;
    if (m) item.metre = m;
  }

  function setBpm(v: string) {
    if (item.kind !== 'bars') return;
    const n = Number(v);
    if (!v.trim() || !(n > 0)) {
      delete item.tempo;
      return;
    }
    item.tempo = { unit: item.tempo?.unit ?? effTempo?.unit ?? { base: 4, dots: 0 }, bpm: n };
  }

  function setUnit(key: string) {
    if (item.kind !== 'bars') return;
    const u = UNITS.find((x) => unitKey(x.v) === key)!.v;
    // Keep the actual speed, re-expressed in the new unit.
    const from = item.tempo ?? effTempo ?? { unit: { base: 4, dots: 0 }, bpm: 120 };
    const conv = convertTempo(from, u);
    item.tempo = { unit: u, bpm: Math.round(conv.bpm * 100) / 100 };
  }

  function setGlide(kind: string) {
    if (item.kind !== 'bars') return;
    if (kind === 'none') {
      delete item.tempoTo;
      return;
    }
    delete item.forever;
    const base = item.tempo ?? effTempo ?? { unit: { base: 4, dots: 0 }, bpm: 120 };
    const factor = kind === 'rit' ? 0.8 : 1.25;
    item.tempoTo = { unit: base.unit, bpm: Math.round(base.bpm * factor) };
  }

  const glideKind = $derived.by(() => {
    if (item.kind !== 'bars' || !item.tempoTo) return 'none';
    const from = item.tempo ?? effTempo;
    if (!from) return 'rit';
    return wholesPerSecond(item.tempoTo) < wholesPerSecond(from) ? 'rit' : 'accel';
  });

  function select(e: MouseEvent) {
    // Clicks inside a nested card belong to that card.
    if ((e.target as Element).closest('.card') !== e.currentTarget) return;
    app.selectedId = item.id;
    if (range && app.status === 'stopped') app.seekBar(range.from);
  }

  function setMark(v: string) {
    if (item.kind === 'repeat') return;
    v = v.trim().replace(/\s+/g, '-').replace(/[:,|]/g, '');
    if (v) item.mark = v;
    else delete item.mark;
  }

  const canJoin = $derived(tree.canJoinPrevious(app.piece.items, item.id));
</script>

<div
  class="card {item.kind}"
  class:selected
  class:playing={playingHere}
  onclickcapture={select}
  role="group"
  aria-label={rangeText || item.kind}
>
  <div class="row">
    {#if item.kind === 'bars'}
      <span class="where" title={rangeText}>{shortRange}</span>
      <input class="mark" type="text" value={item.mark ?? ''} placeholder="mark" maxlength="12" aria-label="Rehearsal mark" title="Rehearsal mark" oninput={(e) => setMark(e.currentTarget.value)} />
      <label class="count" title="Number of bars, or ∞ to keep going until stopped (anything after won't play)">
        <span aria-hidden="true">×</span>
        <input
          type="text"
          inputmode="text"
          aria-label="Bars"
          autocomplete="off"
          value={forever ? '∞' : item.bars}
          oninput={(e) => setCount(e.currentTarget.value)}
          onblur={(e) => (e.currentTarget.value = forever ? '∞' : String(item.kind === 'bars' ? item.bars : ''))}
        />
      </label>
      <input
        class="metre"
        type="text"
        class:bad={metreBad}
        bind:value={metreText}
        placeholder={effMetre ? metreToText(effMetre) : '4/4'}
        oninput={(e) => setMetre(e.currentTarget.value)}
        aria-label="Metre"
        title="Metre, e.g. 4/4, 7/8, 3+2+2/8"
        autocapitalize="off"
        autocomplete="off"
      />
      <div class="tempo" title="Tempo">
        <span class="unit" class:inherited={!item.tempo}>
          {unitSym(item.tempo?.unit ?? effTempo?.unit ?? { base: 4, dots: 0 })}
          <select aria-label="Beat unit" value={unitKey(item.tempo?.unit ?? effTempo?.unit ?? { base: 4, dots: 0 })} onchange={(e) => setUnit(e.currentTarget.value)}>
            {#each UNITS as u}
              <option value={unitKey(u.v)}>{unitLabel(u)}</option>
            {/each}
          </select>
        </span>
        <span class="eq">=</span>
        <input
          type="number"
          inputmode="decimal"
          min="1"
          max="1000"
          step="any"
          aria-label="Beats per minute"
          value={item.tempo ? item.tempo.bpm : ''}
          placeholder={effTempo ? formatNumber(effTempo.bpm) : '120'}
          oninput={(e) => setBpm(e.currentTarget.value)}
        />
      </div>
      {#if item.tempoTo && !open}
        <span class="glide-tag" title="{glideKind === 'rit' ? 'rit.' : 'accel.'} to {formatNumber(item.tempoTo.bpm)}">{glideKind === 'rit' ? '↘' : '↗'}{formatNumber(item.tempoTo.bpm)}</span>
      {/if}
    {:else if item.kind === 'pause'}
      <span class="where" title="Pause"><Icon name="pauseItem" size={16} /></span>
      <input class="mark" type="text" value={item.mark ?? ''} placeholder="mark" maxlength="12" aria-label="Rehearsal mark" title="Rehearsal mark" oninput={(e) => setMark(e.currentTarget.value)} />
      <select
        class="wait"
        aria-label="Continue"
        value={item.seconds === undefined ? 'tap' : 'timed'}
        onchange={(e) => {
          if (item.kind !== 'pause') return;
          if (e.currentTarget.value === 'tap') delete item.seconds;
          else item.seconds = 2;
        }}
      >
        <option value="tap">Wait for tap</option>
        <option value="timed">Wait for…</option>
      </select>
      {#if item.seconds !== undefined}
        <label class="secs">
          <input type="number" inputmode="decimal" min="0.1" step="0.1" aria-label="Seconds" value={item.seconds} oninput={(e) => item.kind === 'pause' && (item.seconds = Math.max(0.1, Number(e.currentTarget.value) || 1))} />
          <span aria-hidden="true">s</span>
        </label>
      {/if}
    {:else}
      <span class="where" title="Repeat"><Icon name="repeat" size={16} /></span>
      <span class="kind">Repeat</span>
      <label class="count" title="Times played in total">
        <span aria-hidden="true">×</span>
        <input type="number" inputmode="numeric" min="1" max="99" aria-label="Times played" value={item.times} oninput={(e) => item.kind === 'repeat' && (item.times = Math.max(1, Number(e.currentTarget.value) || 1))} />
      </label>
    {/if}
    <span class="spacer"></span>
    <button class="icon small more" class:on={open} aria-expanded={open} aria-label="Options" title="Options" onclick={() => (open = !open)}><Icon name="more" size={18} /></button>
  </div>

  {#if open}
    <div class="extra">
      {#if item.kind === 'bars'}
        <div class="opt">
          <span class="lbl">Tempo</span>
          <div class="seg" role="radiogroup" aria-label="Tempo change">
            <button class:on={glideKind === 'none'} aria-pressed={glideKind === 'none'} onclick={() => setGlide('none')}>steady</button>
            <button class:on={glideKind === 'rit'} aria-pressed={glideKind === 'rit'} onclick={() => setGlide('rit')}>rit.</button>
            <button class:on={glideKind === 'accel'} aria-pressed={glideKind === 'accel'} onclick={() => setGlide('accel')}>accel.</button>
          </div>
          {#if item.tempoTo}
            <span class="eq">to</span>
            <input
              class="bpm"
              type="number"
              inputmode="decimal"
              min="1"
              step="any"
              aria-label="Target tempo"
              value={item.tempoTo.bpm}
              oninput={(e) => {
                const n = Number(e.currentTarget.value);
                if (n > 0 && item.kind === 'bars' && item.tempoTo) item.tempoTo.bpm = n;
              }}
            />
          {/if}
        </div>
        <div class="opt">
          <span class="lbl">Numbers</span>
          <div class="seg" role="radiogroup" aria-label="Bar numbers">
            <button class:on={item.barNumber === undefined} aria-pressed={item.barNumber === undefined} onclick={() => item.kind === 'bars' && delete item.barNumber}>auto</button>
            <button class:on={item.barNumber !== undefined} aria-pressed={item.barNumber !== undefined} onclick={() => item.kind === 'bars' && item.barNumber === undefined && (item.barNumber = firstBar?.number ?? 1)}>from</button>
          </div>
          {#if item.barNumber !== undefined}
            <input
              class="bpm"
              type="number"
              inputmode="numeric"
              aria-label="First bar number"
              value={item.barNumber}
              oninput={(e) => {
                const v = e.currentTarget.value;
                if (item.kind === 'bars' && v !== '') item.barNumber = Math.round(Number(v));
              }}
            />
          {/if}
        </div>
      {/if}
      <div class="actions">
        <button class="icon small" title="Move up" aria-label="Move up" onclick={() => tree.move(app.piece.items, item.id, -1)}><Icon name="up" /></button>
        <button class="icon small" title="Move down" aria-label="Move down" onclick={() => tree.move(app.piece.items, item.id, 1)}><Icon name="down" /></button>
        {#if range}
          <button class="icon small" title="Loop this" aria-label="Loop this" onclick={() => app.loopSection(range.from, range.to)}><Icon name="loop" size={18} /></button>
        {/if}
        <button class="icon small" title="Duplicate" aria-label="Duplicate" onclick={() => tree.duplicate(app.piece.items, item.id)}><Icon name="copy" size={18} /></button>
        {#if item.kind !== 'repeat'}
          <button class="icon small" title="Wrap in repeat" aria-label="Wrap in repeat" onclick={() => tree.wrapInRepeat(app.piece.items, item.id)}><Icon name="repeat" size={18} /></button>
        {:else}
          <button class="text" title="Remove the repeat but keep its contents" onclick={() => tree.unwrap(app.piece.items, item.id)}>Unwrap</button>
        {/if}
        {#if canJoin}
          <button class="text" title="Move into the repeat above" onclick={() => tree.joinPrevious(app.piece.items, item.id)}>Into repeat</button>
        {/if}
        <span class="spacer"></span>
        <button class="icon small danger" title="Delete" aria-label="Delete" onclick={() => tree.remove(app.piece.items, item.id)}><Icon name="trash" size={18} /></button>
      </div>
    </div>
  {/if}

  {#if item.kind === 'repeat'}
    <div class="children">
      {#each item.items as child (child.id)}
        <ItemCard item={child} />
      {/each}
      <div class="add-inside">
        <button class="ghost" onclick={() => item.kind === 'repeat' && item.items.push(tree.newBlock())}>+ bars</button>
        <button class="ghost" onclick={() => item.kind === 'repeat' && item.items.push(tree.newPause())}>+ pause</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 8px;
    padding: 0.3rem 0.3rem 0.3rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    position: relative;
    transition: border-color 120ms, box-shadow 120ms;
  }
  .card.selected {
    border-color: var(--c-accent);
  }
  /* Bar under the playhead: a slim marker on the left edge. */
  .card::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: transparent;
  }
  .card.playing::before {
    background: var(--c-playhead);
  }
  .card.pause::before {
    background: var(--c-hold);
    opacity: 0.6;
  }
  .card.repeat {
    background: var(--c-surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2rem;
  }
  .where {
    width: 2.6rem;
    flex: none;
    display: inline-flex;
    justify-content: flex-end;
    padding-right: 0.15rem;
    color: var(--c-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  /* Borderless "chip" inputs: quiet until touched. */
  .row input,
  .row select,
  .extra input {
    border: 1px solid transparent;
    background: var(--c-surface-2);
    border-radius: 6px;
    padding: 0.2rem 0.3rem;
    height: 1.9rem;
    min-width: 0;
  }
  /* Spinners waste space; phones show a number pad anyway. */
  .card input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .card input::-webkit-inner-spin-button,
  .card input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .card.repeat > .row input {
    background: var(--c-surface);
  }
  .row input:hover,
  .row select:hover,
  .extra input:hover {
    border-color: var(--c-border);
  }
  .row input:focus,
  .extra input:focus {
    border-color: var(--c-accent);
    outline: none;
    background: var(--c-surface);
  }
  .mark {
    width: 2.5rem;
    flex: none;
    font-weight: 700;
    text-align: center;
  }
  .mark::placeholder {
    font-weight: 400;
    font-size: 0.7rem;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    color: var(--c-muted);
  }
  .count {
    flex: none;
  }
  .count input {
    width: 2.4rem;
    text-align: center;
  }

  .metre {
    flex: 3 0 4.6rem;
    width: 4.6rem;
    letter-spacing: -0.02em;
    max-width: 6.5rem;
    font-weight: 600;
    text-align: center;
  }
  .tempo {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .tempo {
    flex: none;
  }
  .tempo input {
    width: 3.4rem;
    padding-inline: 0.15rem;
    text-align: center;
  }
  .unit {
    position: relative;
    width: 1.6rem;
    height: 1.9rem;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    border-radius: 6px;
    background: var(--c-surface-2);
  }
  .card.repeat > .row .unit {
    background: var(--c-surface);
  }
  .unit.inherited {
    color: var(--c-muted);
  }
  /* The real select sits invisibly over the symbol so the native picker opens on tap. */
  .unit select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .eq {
    color: var(--c-muted);
    font-size: 0.85rem;
  }
  .glide-tag {
    font-size: 0.75rem;
    color: var(--c-muted);
    white-space: nowrap;
  }
  .wait {
    flex: 0 1 9.5rem;
    min-width: 0;
  }
  .secs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--c-muted);
  }
  .secs input {
    width: 3.2rem;
    text-align: center;
  }
  .kind {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .spacer {
    flex: 1;
  }
  .more {
    flex: none;
    color: var(--c-muted);
  }
  .more.on {
    background: var(--c-surface-2);
    color: var(--c-fg);
  }
  .extra {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.3rem 0 0 3.2rem;
    border-top: 1px dashed var(--c-border);
    margin-top: 0.1rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .lbl {
    width: 4.2rem;
    font-size: 0.75rem;
    color: var(--c-muted);
  }
  .bpm {
    width: 3.6rem;
    text-align: center;
  }
  .seg {
    display: inline-flex;
    background: var(--c-surface-2);
    padding: 2px;
    border-radius: 7px;
  }
  .card.repeat > .extra .seg {
    background: var(--c-surface);
  }
  .seg button {
    border: none;
    background: none;
    padding: 0.15rem 0.55rem;
    border-radius: 5px;
    font-size: 0.8rem;
    color: var(--c-muted);
  }
  .seg button.on {
    background: var(--c-surface);
    color: var(--c-fg);
    box-shadow: var(--shadow-sm);
  }
  .card.repeat > .extra .seg button.on {
    background: var(--c-surface-2);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-left: -0.3rem;
  }
  .actions .text {
    border: none;
    background: none;
    font-size: 0.8rem;
    padding: 0.2rem 0.45rem;
    color: var(--c-muted);
  }
  .actions .text:hover {
    background: var(--c-surface-2);
    color: var(--c-fg);
  }
  input.bad {
    border-color: var(--c-danger) !important;
  }
  .danger {
    color: var(--c-danger);
  }
  .children {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-left: 0.9rem;
    padding-left: 0.4rem;
    border-left: 3px double var(--c-fg);
  }
  .add-inside {
    display: flex;
    gap: 0.3rem;
  }
  .add-inside button {
    padding: 0.15rem 0.6rem;
  }
  /* Narrow phones: give the metre room by trimming the decorations. */
  @media (max-width: 400px) {
    .row {
      gap: 0.2rem;
    }
    .where {
      width: 2.3rem;
      font-size: 0.7rem;
    }
    .tempo .eq {
      display: none;
    }
    .tempo input {
      width: 3rem;
    }
    .mark {
      width: 2.5rem;
    }
    .count input {
      width: 2rem;
    }
    .more {
      width: 26px;
    }
    .extra {
      padding-left: 0.6rem;
    }
  }
</style>
