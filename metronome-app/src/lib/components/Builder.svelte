<script lang="ts">
  import { app } from '../state/app.svelte';
  import * as tree from '../model/tree';
  import ItemCard from './ItemCard.svelte';
  import Icon from './Icon.svelte';

  function add(kind: 'bars' | 'pause' | 'repeat') {
    const it = kind === 'bars' ? tree.newBlock() : kind === 'pause' ? tree.newPause() : tree.newRepeat();
    // Insert after the selected item if there is one, else at the end.
    const loc = app.selectedId ? tree.locate(app.piece.items, app.selectedId) : null;
    if (loc) loc.list.splice(loc.index + 1, 0, it);
    else app.piece.items.push(it);
    app.selectedId = it.id;
  }
</script>

<div class="builder">
  <label class="title">
    <span class="sr">Title</span>
    <input type="text" placeholder="Untitled piece" bind:value={app.piece.title} />
  </label>

  {#if app.piece.items.length === 0}
    <p class="empty">Nothing here yet. Add some bars to get started.</p>
  {/if}

  <div class="items">
    {#each app.piece.items as item (item.id)}
      <ItemCard {item} />
    {/each}
  </div>

  <div class="add">
    <button onclick={() => add('bars')}><Icon name="bars" size={18} /> Add bars</button>
    <button onclick={() => add('pause')}><Icon name="pauseItem" size={18} /> Add pause</button>
    <button onclick={() => add('repeat')}><Icon name="repeat" size={18} /> Add repeat</button>
  </div>
</div>

<style>
  .builder {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .title input {
    width: 100%;
    font-size: 1.15rem;
    font-weight: 700;
    border: 1px solid transparent;
    background: transparent;
    padding: 0.3rem 0.4rem;
  }
  .title input:hover,
  .title input:focus {
    border-color: var(--c-border);
    background: var(--c-surface);
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .add {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    position: sticky;
    bottom: 0;
    background: var(--c-bg);
    padding: 0.5rem 0;
  }
  .add button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .empty {
    color: var(--c-muted);
  }
</style>
