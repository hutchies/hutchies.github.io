<script lang="ts">
  import { app } from '../state/app.svelte';
  import { LEVEL_NAMES, DEFAULT_SOUND, type Timbre } from '../audio/sounds';

  let { onlatency }: { onlatency: () => void } = $props();

  const s = app.settings;
  const save = () => app.persistSettings();
  const TIMBRES: { v: Timbre; label: string }[] = [
    { v: 'wood', label: 'Woodblock' },
    { v: 'beep', label: 'Beep' },
    { v: 'click', label: 'Click' },
    { v: 'bell', label: 'Bell' },
  ];

  function setSubdivide(n: number) {
    app.settings.subdivide = n;
    save();
  }
</script>

<div class="settings">
  <section>
    <h3>Sound</h3>
    <div class="grid">
      <label for="timbre">Sound</label>
      <select id="timbre" bind:value={s.sound.timbre} onchange={save}>
        {#each TIMBRES as t}<option value={t.v}>{t.label}</option>{/each}
      </select>
      <label for="vol">Volume</label>
      <input id="vol" type="range" min="0" max="1" step="0.01" bind:value={s.sound.volume} oninput={save} />
      <label for="mute">Mute clicks</label>
      <input id="mute" type="checkbox" bind:checked={s.muted} onchange={save} />
      <label for="sub">Subdivide pulses</label>
      <select id="sub" value={s.subdivide} onchange={(e) => setSubdivide(Number(e.currentTarget.value))}>
        <option value={1}>Off</option>
        <option value={2}>In 2</option>
        <option value={3}>In 3</option>
        <option value={4}>In 4</option>
      </select>
    </div>
    <details>
      <summary>Accent levels</summary>
      <table class="levels">
        <thead><tr><th></th><th>Level</th><th>Pitch</th></tr></thead>
        <tbody>
          {#each s.sound.levels as lv, i}
            <tr>
              <td>{LEVEL_NAMES[i]}</td>
              <td><input type="range" min="0" max="1" step="0.01" bind:value={lv.gain} oninput={save} aria-label="{LEVEL_NAMES[i]} level" /></td>
              <td><input type="number" min="100" max="6000" step="10" bind:value={lv.pitch} oninput={save} aria-label="{LEVEL_NAMES[i]} pitch" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button
        class="link"
        onclick={() => {
          app.settings.sound = structuredClone(DEFAULT_SOUND);
          save();
        }}>Reset sounds</button
      >
    </details>
  </section>

  <section>
    <h3>Display</h3>
    <div class="grid">
      <label for="zoom">Zoom</label>
      <input id="zoom" type="range" min="30" max="600" step="1" bind:value={s.pxPerSecond} oninput={save} />
      <label for="ph">Playhead position</label>
      <input id="ph" type="range" min="0.08" max="0.6" step="0.01" bind:value={s.playhead} oninput={save} />
      <label for="flash">Visual beat flash</label>
      <select id="flash" bind:value={s.flash} onchange={save}>
        <option value="off">Off</option>
        <option value="display">Display, on downbeats</option>
        <option value="edges">Screen edges, every beat</option>
      </select>
      <label for="rows">Focus view rows</label>
      <select id="rows" value={s.focusRows} onchange={(e) => { app.settings.focusRows = Number(e.currentTarget.value); save(); }}>
        <option value={0}>Auto (more in portrait)</option>
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
      </select>
      <label for="theme">Theme</label>
      <select id="theme" bind:value={s.theme} onchange={save}>
        <option value="auto">Match system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <label for="names">Note names</label>
      <select id="names" value={s.british ? 'uk' : 'us'} onchange={(e) => { app.settings.british = e.currentTarget.value === 'uk'; save(); }}>
        <option value="uk">Crotchet, quaver (c=120)</option>
        <option value="us">Quarter, eighth (4=120)</option>
      </select>
    </div>
  </section>

  <section>
    <h3>Latency</h3>
    <p class="note">
      The display already allows for the latency your device reports, but wireless headphones and speakers are often
      later than they say. <button class="link inline" onclick={onlatency}>Measure my latency</button> (tap along for
      about 20 seconds), or adjust by hand until the clicks match the playhead. Playing in a group, this also starts
      your clicks earlier to match everyone else's.
    </p>
    <div class="grid">
      <label for="off">Display delay</label>
      <div class="row">
        <input id="off" type="range" min="-150" max="500" step="5" bind:value={s.visualOffsetMs} oninput={save} />
        <span class="val">{s.visualOffsetMs} ms</span>
      </div>
    </div>
  </section>
</div>

<style>
  .link.inline {
    display: inline;
    font-size: inherit;
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--c-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  .grid input[type='checkbox'] {
    justify-self: start;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .row input {
    flex: 1;
  }
  .val {
    font-variant-numeric: tabular-nums;
    min-width: 4rem;
  }
  .note {
    font-size: 0.85rem;
    color: var(--c-muted);
    margin: 0 0 0.5rem;
  }
  .levels {
    width: 100%;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .levels th {
    text-align: left;
    color: var(--c-muted);
    font-weight: 500;
  }
  .levels input[type='number'] {
    width: 5rem;
  }
  details summary {
    cursor: pointer;
    color: var(--c-accent);
    margin-top: 0.5rem;
  }
  @media (max-width: 500px) {
    .grid {
      grid-template-columns: 1fr;
      gap: 0.25rem;
    }
  }
</style>
