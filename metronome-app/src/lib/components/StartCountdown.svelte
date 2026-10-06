<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';

  /**
   * Group start: a big countdown over the display until the leader's
   * downbeat, then "GO" for a moment while the metronome carries on below.
   */
  let text = $state('');
  let go = $state(false);
  let far = $state(false);

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const g = app.group;
      const p = g?.playback;
      let t = '';
      let isGo = false;
      let isFar = false;
      if (g && p?.mode === 'playing' && p.startAt !== null && g.phase === 'live') {
        const left = p.startAt - g.serverNow() / 1000;
        if (left > 0) {
          t = String(Math.ceil(left));
          isFar = left > 3;
        } else if (left > -0.7) {
          t = 'GO';
          isGo = true;
        }
      }
      if (t !== text) text = t;
      if (isGo !== go) go = isGo;
      if (isFar !== far) far = isFar;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if text}
  <div class="countdown" class:go class:far aria-live="polite">{text}</div>
{/if}

<style>
  .countdown {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    font-size: min(30vh, 22vw, 14rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: var(--c-countin);
    opacity: 0.55;
    text-shadow: 0 2px 12px rgb(0 0 0 / 0.15);
    z-index: 2;
  }
  .countdown.far {
    opacity: 0.3;
  }
  .countdown.go {
    color: var(--c-loop);
    opacity: 0.8;
  }
</style>
