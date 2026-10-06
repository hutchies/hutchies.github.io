<script lang="ts">
  import { app } from '../state/app.svelte';
  import { shareUrl } from '../model/share';

  let url = $state('');
  let copied = $state(false);

  $effect(() => {
    shareUrl(app.projectText()).then((u) => (url = u));
  });

  async function copy() {
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function nativeShare() {
    await navigator.share?.({ title: app.project.title || 'Metronome map', url }).catch(() => {});
  }
</script>

<div class="share">
  <p>This link contains the whole map. Anyone who opens it gets the same bars, metres and tempi, and nothing is stored on a server.</p>
  <div class="row">
    <input type="text" readonly value={url} onfocus={(e) => e.currentTarget.select()} aria-label="Share link" />
    <button class="primary" onclick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
  </div>
  {#if 'share' in navigator}
    <button onclick={nativeShare}>Share…</button>
  {/if}
  <p class="small">{url.length} characters</p>
</div>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .row input {
    flex: 1;
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .small {
    color: var(--c-muted);
    font-size: 0.8rem;
  }
</style>
