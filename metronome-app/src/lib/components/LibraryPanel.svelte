<script lang="ts">
  import { app, EXAMPLE } from '../state/app.svelte';

  let { onclose }: { onclose: () => void } = $props();

  function open(text: string) {
    app.loadText(text);
    onclose();
  }
</script>

<div class="library">
  <div class="actions">
    <button class="primary" onclick={() => app.saveToLibrary()}>Save “{app.project.title || 'Untitled'}”</button>
    <button onclick={() => open('# Untitled\nc=120 4/4 x4')}>New</button>
    <button onclick={() => open(EXAMPLE)}>Load example</button>
  </div>
  {#if app.library.length === 0}
    <p class="muted">Saved maps are kept in this browser. Use the share link to move them between devices.</p>
  {:else}
    <ul>
      {#each app.library as e (e.id)}
        <li>
          <button class="entry" onclick={() => open(e.text)}>
            <b>{e.title}</b>
            <span class="muted">{new Date(e.updated).toLocaleString()}</span>
          </button>
          <button class="link danger" onclick={() => app.deleteFromLibrary(e.id)}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .entry {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    text-align: left;
  }
  .muted {
    color: var(--c-muted);
    font-size: 0.85rem;
  }
  .danger {
    color: var(--c-danger);
  }
</style>
