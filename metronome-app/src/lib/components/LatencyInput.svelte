<script lang="ts">
  import { app } from '../state/app.svelte';

  /** Type in the display delay (audio latency) by hand, or nudge it in 5 ms steps. */
  let { id = 'latency-ms' }: { id?: string } = $props();

  const MIN = -150;
  const MAX = 500;

  function set(ms: number) {
    if (!Number.isFinite(ms)) return;
    app.settings.visualOffsetMs = Math.max(MIN, Math.min(MAX, Math.round(ms)));
    app.persistSettings();
  }
</script>

<span class="latency-input">
  <button class="icon small" onclick={() => set(app.settings.visualOffsetMs - 5)} aria-label="5 ms less">−</button>
  <input
    {id}
    type="number"
    min={MIN}
    max={MAX}
    step="5"
    value={app.settings.visualOffsetMs}
    onchange={(e) => set(Number(e.currentTarget.value))}
  />
  <span class="unit">ms</span>
  <button class="icon small" onclick={() => set(app.settings.visualOffsetMs + 5)} aria-label="5 ms more">+</button>
</span>

<style>
  .latency-input {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  input {
    width: 5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    color: var(--c-muted);
  }
  button {
    font-size: 1.1rem;
    font-weight: 700;
  }
</style>
