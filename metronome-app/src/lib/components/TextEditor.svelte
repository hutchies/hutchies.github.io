<script lang="ts">
  import { app } from '../state/app.svelte';

  let showHelp = $state(false);
  const errorLines = $derived(new Set(app.errors.map((e) => e.line)));
  const lineCount = $derived(app.text.split('\n').length);
  let gutter: HTMLDivElement;
</script>

<div class="text-editor">
  <div class="editor" class:has-errors={app.errors.length > 0}>
    <div class="gutter" bind:this={gutter} aria-hidden="true">
      {#each Array(lineCount) as _, i}
        <div class:err={errorLines.has(i + 1)}>{i + 1}</div>
      {/each}
    </div>
    <textarea
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      value={app.text}
      onfocus={() => (app.editingText = true)}
      onblur={() => (app.editingText = false)}
      oninput={(e) => app.setText(e.currentTarget.value)}
      onscroll={(e) => (gutter.scrollTop = e.currentTarget.scrollTop)}
      aria-label="Metronome map as text"
      aria-invalid={app.errors.length > 0}
    ></textarea>
  </div>

  {#if app.errors.length}
    <ul class="errors" role="alert">
      {#each app.errors as e}
        <li><b>Line {e.line}:</b> {e.message}</li>
      {/each}
    </ul>
  {:else}
    <p class="ok">✓ {app.timeline.bars.length} bars · {Math.floor(app.timeline.duration / 60)}:{String(Math.round(app.timeline.duration % 60)).padStart(2, '0')}</p>
  {/if}

  <button class="link" onclick={() => (showHelp = !showHelp)} aria-expanded={showHelp}>
    {showHelp ? 'Hide' : 'Show'} syntax guide
  </button>
  {#if showHelp}
    <div class="help">
      <p>Separate entries with commas or new lines. Each entry is a block of bars made of any of these, separated by spaces. Anything you leave out carries on from the block before.</p>
      <table>
        <tbody>
          <tr><td><code>A:</code></td><td>Rehearsal mark</td></tr>
          <tr><td><code>7/8</code> <code>3+2+2/8</code></td><td>Metre, with optional beat grouping. 6/8, 9/8, 12/8 group in threes automatically.</td></tr>
          <tr><td><code>c=120</code> <code>q.=80</code> <code>4=96</code></td><td>Tempo. Units: <code>sb m c q sq ds</code> (or <code>1 2 4 8 16 32</code>). Add <code>.</code> for dotted.</td></tr>
          <tr><td><code>x8</code></td><td>Number of bars (default 1)</td></tr>
          <tr><td><code>rit c=90</code> <code>accel c=140</code></td><td>Gradual tempo change across the block, ending at that tempo</td></tr>
          <tr><td><code>@17</code></td><td>The block's first bar is bar 17 (e.g. <code>@0</code> for an upbeat)</td></tr>
          <tr><td><code>wait</code> · <code>wait 3s</code></td><td>Pause until tapped, or for a set time</td></tr>
          <tr><td><code>|:</code> … <code>:|</code> · <code>:| x3</code></td><td>Repeat (twice, or this many times in total)</td></tr>
          <tr><td><code># Title</code> · <code>// note</code></td><td>Title (first line) and comments</td></tr>
        </tbody>
      </table>
      <p>Example: <code>A: c=120 4/4 x4, 3/4, B: 3+3+2/8 x2 rit c=100</code></p>
    </div>
  {/if}
</div>

<style>
  .text-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .editor {
    display: flex;
    border: 1px solid var(--c-border);
    border-radius: 10px;
    background: var(--c-surface);
    overflow: hidden;
    height: min(55vh, 28rem);
  }
  .editor:focus-within {
    border-color: var(--c-accent);
  }
  .editor.has-errors {
    border-color: var(--c-danger);
  }
  .gutter {
    padding: 0.6rem 0.4rem;
    text-align: right;
    color: var(--c-muted);
    background: var(--c-surface-2);
    font: 0.85rem/1.5 var(--mono);
    overflow: hidden;
    user-select: none;
    min-width: 2.2rem;
  }
  .gutter .err {
    color: var(--c-danger);
    font-weight: 700;
  }
  textarea {
    flex: 1;
    border: none;
    outline: none;
    resize: none;
    padding: 0.6rem;
    font: 0.85rem/1.5 var(--mono);
    background: transparent;
    color: var(--c-fg);
    white-space: pre;
    border-radius: 0;
  }
  .errors {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--c-danger);
    font-size: 0.85rem;
  }
  .ok {
    margin: 0;
    color: var(--c-muted);
    font-size: 0.85rem;
  }
  .help {
    font-size: 0.85rem;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 10px;
    padding: 0.6rem 0.8rem;
  }
  .help table {
    border-collapse: collapse;
  }
  .help td {
    padding: 0.25rem 0.5rem 0.25rem 0;
    vertical-align: top;
  }
  .help td:first-child {
    white-space: nowrap;
  }
  code {
    font-family: var(--mono);
    background: var(--c-surface-2);
    padding: 0 0.25rem;
    border-radius: 4px;
  }
</style>
