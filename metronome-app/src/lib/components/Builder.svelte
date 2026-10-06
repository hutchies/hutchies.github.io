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

<!-- Suggestion for every block's bar-count field, so ∞ is one tap away on phones. -->
<datalist id="bar-count-options"><option value="∞">indefinitely</option></datalist>

<div class="builder">
  {#if app.piece.items.length === 0}
    <p class="empty">Nothing here yet. Add some bars to get started.</p>
  {/if}

  <div class="items">
    {#each app.piece.items as item (item.id)}
      <ItemCard {item} />
    {/each}
  </div>

  <div class="add">
    <span class="lbl">Add</span>
    <button onclick={() => add('bars')}><Icon name="bars" size={16} /> Bars</button>
    <button onclick={() => add('pause')}><Icon name="pauseItem" size={16} /> Pause</button>
    <button onclick={() => add('repeat')}><Icon name="repeat" size={16} /> Repeat</button>
  </div>
</div>

<style>
  .builder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    position: sticky;
    bottom: 0;
    background: var(--c-bg);
    padding: 0.5rem 0;
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--c-border);
  }
  .add button {
    padding: 0.3rem 0.65rem;
    font-size: 0.85rem;
  }
  .lbl {
    font-size: 0.8rem;
    color: var(--c-muted);
    margin-right: 0.15rem;
  }
  .empty {
    color: var(--c-muted);
  }
</style>
