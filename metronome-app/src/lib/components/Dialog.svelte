<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { open = $bindable(false), title, children }: { open: boolean; title: string; children: Snippet } = $props();
  let el: HTMLDialogElement;

  $effect(() => {
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} onclose={() => (open = false)} onclick={(e) => e.target === el && (open = false)}>
  <div class="inner">
    <header>
      <h2>{title}</h2>
      <button class="icon" onclick={() => (open = false)} aria-label="Close"><Icon name="close" /></button>
    </header>
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    border: 1px solid var(--c-border);
    border-radius: 14px;
    padding: 0;
    background: var(--c-bg);
    color: var(--c-fg);
    width: min(36rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .inner {
    padding: 1rem 1.2rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
  }
</style>
