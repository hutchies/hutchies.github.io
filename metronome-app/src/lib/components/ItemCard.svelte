<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { Item, Metre, NoteValue, Tempo } from '../model/types';
  import { metreToText, formatNumber, tempoToText, wholesPerSecond, convertTempo } from '../model/music';
  import { parseMetre } from '../model/syntax';
  import * as tree from '../model/tree';
  import Icon from './Icon.svelte';
  import ItemCard from './ItemCard.svelte';

  let { item, depth = 0 }: { item: Item; depth?: number } = $props();

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

  const range = $derived(app.barsForItem(item.id));
  const firstBar = $derived(range ? app.timeline.bars[range.from] : undefined);
  const rangeText = $derived.by(() => {
    if (!range) return '';
    const bars = app.timeline.bars;
    const a = bars[range.from];
    // Bars in the first pass only.
    let last = range.from;
    while (last + 1 <= range.to && bars[last + 1].number > bars[last].number) last++;
    const b = bars[last];
    return a.number === b.number ? `Bar ${a.number}` : `Bars ${a.number}–${b.number}`;
  });
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

  function select() {
    app.selectedId = item.id;
    if (range && app.status === 'stopped') app.seekBar(range.from);
  }

  const canJoin = $derived(tree.canJoinPrevious(app.piece.items, item.id));
</script>

<div
  class="card {item.kind}"
  class:selected
  class:playing={playingHere}
  style:--depth={depth}
  onclickcapture={select}
  role="group"
  aria-label={rangeText || item.kind}
>
  <div class="head">
    {#if item.kind === 'bars'}
      <span class="kind"><Icon name="bars" size={16} /> {rangeText}</span>
    {:else if item.kind === 'pause'}
      <span class="kind"><Icon name="pauseItem" size={16} /> Pause</span>
    {:else}
      <span class="kind"><Icon name="repeat" size={16} /> Repeat</span>
    {/if}
    <span class="spacer"></span>
    <div class="tools">
      <button class="icon small" title="Move up" aria-label="Move up" onclick={() => tree.move(app.piece.items, item.id, -1)}><Icon name="up" size={18} /></button>
      <button class="icon small" title="Move down" aria-label="Move down" onclick={() => tree.move(app.piece.items, item.id, 1)}><Icon name="down" size={18} /></button>
      {#if range}
        <button class="icon small" title="Loop this" aria-label="Loop this" onclick={() => app.loopSection(range.from, range.to)}><Icon name="loop" size={16} /></button>
      {/if}
      <details class="menu">
        <summary class="icon small" title="More" aria-label="More actions">⋯</summary>
        <div class="menu-body">
          <button onclick={() => tree.duplicate(app.piece.items, item.id)}><Icon name="copy" size={16} /> Duplicate</button>
          {#if item.kind !== 'repeat'}
            <button onclick={() => tree.wrapInRepeat(app.piece.items, item.id)}><Icon name="repeat" size={16} /> Wrap in repeat</button>
          {:else}
            <button onclick={() => tree.unwrap(app.piece.items, item.id)}><Icon name="repeat" size={16} /> Remove repeat (keep contents)</button>
          {/if}
          {#if item.kind === 'bars'}
            {#if item.barNumber === undefined}
              <button onclick={() => item.kind === 'bars' && (item.barNumber = firstBar?.number ?? 1)}># Renumber from here</button>
            {:else}
              <button onclick={() => item.kind === 'bars' && delete item.barNumber}># Automatic bar numbers</button>
            {/if}
          {/if}
          {#if canJoin}
            <button onclick={() => tree.joinPrevious(app.piece.items, item.id)}><Icon name="up" size={16} /> Move into repeat above</button>
          {/if}
          <button class="danger" onclick={() => tree.remove(app.piece.items, item.id)}><Icon name="trash" size={16} /> Delete</button>
        </div>
      </details>
    </div>
  </div>

  {#if item.kind === 'bars'}
    <div class="fields">
      <label class="f mark">
        <span>Mark</span>
        <input
          type="text"
          value={item.mark ?? ''}
          placeholder="–"
          maxlength="12"
          oninput={(e) => {
            const v = e.currentTarget.value.trim().replace(/\s+/g, '-').replace(/[:,|]/g, '');
            if (v) item.mark = v;
            else delete item.mark;
          }}
        />
      </label>
      <label class="f bars">
        <span>Bars</span>
        <input type="number" min="1" max="999" value={item.bars} oninput={(e) => (item.bars = Math.max(1, Number(e.currentTarget.value) || 1))} />
      </label>
      <label class="f metre">
        <span>Metre</span>
        <input
          type="text"
          class:bad={metreBad}
          bind:value={metreText}
          placeholder={effMetre ? metreToText(effMetre) : '4/4'}
          oninput={(e) => setMetre(e.currentTarget.value)}
          title="e.g. 4/4, 7/8, 3+2+2/8"
          inputmode="text"
        />
      </label>
      <div class="f tempo">
        <span>Tempo</span>
        <div class="row">
          <select
            aria-label="Beat unit"
            value={unitKey(item.tempo?.unit ?? effTempo?.unit ?? { base: 4, dots: 0 })}
            onchange={(e) => setUnit(e.currentTarget.value)}
            class:inherited={!item.tempo}
          >
            {#each UNITS as u}
              <option value={unitKey(u.v)}>{unitLabel(u)}</option>
            {/each}
          </select>
          <span class="eq">=</span>
          <input
            type="number"
            min="1"
            max="1000"
            step="any"
            aria-label="Beats per minute"
            value={item.tempo ? item.tempo.bpm : ''}
            placeholder={effTempo ? formatNumber(effTempo.bpm) : '120'}
            oninput={(e) => setBpm(e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="f glide">
        <span>Change</span>
        <div class="row">
          <select aria-label="Tempo change" value={glideKind} onchange={(e) => setGlide(e.currentTarget.value)}>
            <option value="none">steady</option>
            <option value="rit">rit. to</option>
            <option value="accel">accel. to</option>
          </select>
          {#if item.tempoTo}
            <input
              type="number"
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
      </div>
{#if item.barNumber !== undefined}
        <label class="f num">
          <span>Bar no.</span>
          <input
            type="number"
            value={item.barNumber}
            oninput={(e) => {
              const v = e.currentTarget.value;
              if (item.kind === 'bars' && v !== '') item.barNumber = Math.round(Number(v));
            }}
          />
        </label>
      {/if}
    </div>
    {#if item.tempoTo && effTempo}
      <div class="hint">{glideKind === 'rit' ? 'Slowing' : 'Speeding up'} from {tempoToText(item.tempo ?? effTempo, app.settings.british)} to {tempoToText(item.tempoTo, app.settings.british)} across the block</div>
    {/if}
  {:else if item.kind === 'pause'}
    <div class="fields">
      <label class="f mark">
        <span>Mark</span>
        <input
          type="text"
          value={item.mark ?? ''}
          placeholder="–"
          maxlength="12"
          oninput={(e) => {
            const v = e.currentTarget.value.trim().replace(/\s+/g, '-').replace(/[:,|]/g, '');
            if (v) item.mark = v;
            else delete item.mark;
          }}
        />
      </label>
      <div class="f">
        <span>Continue</span>
        <select
          value={item.seconds === undefined ? 'tap' : 'timed'}
          onchange={(e) => {
            if (item.kind !== 'pause') return;
            if (e.currentTarget.value === 'tap') delete item.seconds;
            else item.seconds = 2;
          }}
        >
          <option value="tap">when tapped</option>
          <option value="timed">after a time</option>
        </select>
      </div>
      {#if item.seconds !== undefined}
        <label class="f bars">
          <span>Seconds</span>
          <input type="number" min="0.1" step="0.1" value={item.seconds} oninput={(e) => item.kind === 'pause' && (item.seconds = Math.max(0.1, Number(e.currentTarget.value) || 1))} />
        </label>
      {/if}
    </div>
  {:else}
    <div class="fields">
      <label class="f bars">
        <span>Play</span>
        <div class="row">
          <input type="number" min="1" max="99" value={item.times} oninput={(e) => item.kind === 'repeat' && (item.times = Math.max(1, Number(e.currentTarget.value) || 1))} />
          <span class="eq">times</span>
        </div>
      </label>
    </div>
    <div class="children">
      {#each item.items as child (child.id)}
        <ItemCard item={child} depth={depth + 1} />
      {/each}
      <div class="add-inside">
        <button class="ghost" onclick={() => item.kind === 'repeat' && item.items.push(tree.newBlock())}>+ Bars</button>
        <button class="ghost" onclick={() => item.kind === 'repeat' && item.items.push(tree.newPause())}>+ Pause</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 10px;
    padding: 0.5rem 0.6rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-left: 4px solid var(--c-border);
    transition: border-color 120ms, box-shadow 120ms;
  }
  .card.selected {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent);
  }
  .card.playing {
    border-left-color: var(--c-playhead);
  }
  .card.repeat {
    background: var(--c-surface-2);
  }
  .card.pause {
    border-left-color: var(--c-hold);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--c-muted);
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .tools {
    display: flex;
    gap: 0.1rem;
    align-items: center;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.6rem;
    align-items: flex-end;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.75rem;
    color: var(--c-muted);
  }
  .f > span {
    padding-left: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .eq {
    color: var(--c-muted);
  }
  .mark input {
    width: 3.5rem;
    font-weight: 700;
    text-align: center;
  }
  .bars input,
  .num input {
    width: 4.2rem;
  }
  .metre input {
    width: 5.5rem;
    font-weight: 600;
  }
  .tempo input,
  .glide input {
    width: 4.6rem;
  }
  .tempo select {
    max-width: 9.5rem;
  }
  select.inherited {
    color: var(--c-muted);
  }
  input.bad {
    border-color: var(--c-danger);
    outline-color: var(--c-danger);
  }
  .hint {
    font-size: 0.75rem;
    color: var(--c-muted);
    font-style: italic;
  }
  .children {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-left: 0.6rem;
    border-left: 3px double var(--c-fg);
    margin-left: 0.2rem;
  }
  .add-inside {
    display: flex;
    gap: 0.4rem;
  }
  .menu {
    position: relative;
  }
  .menu summary {
    list-style: none;
    cursor: pointer;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .menu summary::-webkit-details-marker {
    display: none;
  }
  .menu-body {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 20;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    padding: 0.3rem;
    min-width: 13rem;
  }
  .menu-body button {
    justify-content: flex-start;
    border: none;
    background: none;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.45rem 0.6rem;
    text-align: left;
  }
  .menu-body button:hover {
    background: var(--c-surface-2);
  }
  .danger {
    color: var(--c-danger);
  }
</style>
