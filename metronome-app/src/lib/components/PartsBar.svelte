<script lang="ts">
  import { app } from '../state/app.svelte';
  import { TIMBRES } from '../model/project';
  import type { Timbre } from '../audio/sounds';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  /**
   * The project's parts as a mixer: tap a name to show and edit that part
   * (it drives the display), M/S to mute or solo it. Each part can have its
   * own click sound.
   */
  const TIMBRE_LABEL: Record<Timbre, string> = { wood: 'Woodblock', beep: 'Beep', click: 'Click', bell: 'Bell' };

  let editing = $state<number | null>(null);
  let showPart = $state(false);
  let nameDraft = $state('');

  const parts = $derived(app.project.parts);
  const locked = $derived(app.following);

  function openSettings(i: number) {
    editing = i;
    nameDraft = parts[i].name;
    showPart = true;
  }

  function commitName() {
    if (editing !== null && nameDraft.trim()) app.renamePart(editing, nameDraft);
  }
</script>

<div class="parts" role="group" aria-label="Parts">
  <span class="lbl">{parts.length > 1 ? 'Parts' : 'Part'}</span>
  {#each parts as p, i (i)}
    <span class="chip" class:active={i === app.activeIndex} class:silent={!app.audible.has(p.name)}>
      <button
        class="name"
        onclick={() => app.setActivePart(i)}
        disabled={locked && i !== app.activeIndex}
        title={locked ? 'The leader assigns your part' : 'Show and edit this part'}
      >{p.name}</button>
      {#if parts.length > 1}
        <button
          class="ms"
          class:on={app.mix.muted.includes(p.name)}
          onclick={() => app.toggleMutePart(p.name)}
          title="Mute {p.name}"
          aria-label="Mute {p.name}"
          aria-pressed={app.mix.muted.includes(p.name)}>M</button
        >
        <button
          class="ms solo"
          class:on={app.mix.solo.includes(p.name)}
          onclick={() => app.toggleSoloPart(p.name)}
          title="Solo {p.name}"
          aria-label="Solo {p.name}"
          aria-pressed={app.mix.solo.includes(p.name)}>S</button
        >
      {/if}
      <button class="ms" onclick={() => openSettings(i)} title="Sound and name" aria-label="{p.name} settings">
        <Icon name="settings" size={14} />
      </button>
    </span>
  {/each}
  {#if !locked}
    <button class="link" onclick={() => app.addPart()} title="Add a part (starts as a copy of this one)">+ Add part</button>
  {/if}
</div>

<Dialog bind:open={showPart} title="Part">
  {#if editing !== null && parts[editing]}
    {@const p = parts[editing]}
    {@const i = editing}
    <div class="grid">
      <label for="pt-name">Name</label>
      <input id="pt-name" type="text" maxlength="40" bind:value={nameDraft} onchange={commitName} disabled={locked} />
      <label for="pt-timbre">Click sound</label>
      <select
        id="pt-timbre"
        value={p.sound.timbre ?? ''}
        onchange={(e) => app.setPartSound(i, { timbre: (e.currentTarget.value || null) as Timbre | null })}
      >
        <option value="">Same as settings ({TIMBRE_LABEL[app.settings.sound.timbre]})</option>
        {#each TIMBRES as t}<option value={t}>{TIMBRE_LABEL[t]}</option>{/each}
      </select>
      <label for="pt-vol">Volume</label>
      <div class="row">
        <input id="pt-vol" type="range" min="0" max="1" step="0.05" value={p.sound.volume} oninput={(e) => app.setPartSound(i, { volume: Number(e.currentTarget.value) })} />
        <span class="val">{Math.round(p.sound.volume * 100)}%</span>
      </div>
      <label for="pt-pitch">Pitch</label>
      <div class="row">
        <input id="pt-pitch" type="range" min="-12" max="12" step="1" value={p.sound.transpose} oninput={(e) => app.setPartSound(i, { transpose: Number(e.currentTarget.value) })} />
        <span class="val">{p.sound.transpose > 0 ? '+' : ''}{p.sound.transpose} st</span>
      </div>
    </div>
    <p class="note">
      The sound is saved with the project (and shared with the group). Mute and solo are just for this device.
    </p>
    {#if parts.length > 1 && !locked}
      <div class="row end">
        <button class="danger" onclick={() => { showPart = false; editing = null; app.removePart(i); }}>Delete part</button>
      </div>
    {/if}
  {/if}
</Dialog>

<style>
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .lbl {
    color: var(--c-muted);
    font-size: 0.85rem;
    margin-right: 0.2rem;
  }
  .chip {
    display: inline-flex;
    border: 1px solid var(--c-border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--c-surface);
  }
  .chip.active {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent);
  }
  .chip.silent .name {
    color: var(--c-muted);
    text-decoration: line-through;
  }
  .chip button {
    border: none;
    border-radius: 0;
    background: none;
    padding: 0.25rem 0.5rem;
  }
  .chip .name {
    font-weight: 700;
  }
  .chip .name:disabled {
    opacity: 1;
  }
  .ms {
    border-left: 1px solid var(--c-border) !important;
    color: var(--c-muted);
    font-size: 0.75rem;
    font-weight: 700;
    min-width: 1.8rem;
  }
  .ms.on {
    background: var(--c-hold) !important;
    color: #fff;
  }
  .ms.solo.on {
    background: var(--c-loop) !important;
  }
  .grid {
    display: grid;
    grid-template-columns: 8rem 1fr;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .row input {
    flex: 1;
  }
  .row.end {
    justify-content: flex-end;
  }
  .val {
    min-width: 3.5rem;
    font-variant-numeric: tabular-nums;
  }
  .note {
    font-size: 0.85rem;
    color: var(--c-muted);
    margin: 0;
  }
  .danger {
    color: var(--c-danger);
  }
</style>
