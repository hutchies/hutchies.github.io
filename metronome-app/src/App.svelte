<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from './lib/state/app.svelte';
  import Display from './lib/components/Display.svelte';
  import Transport from './lib/components/Transport.svelte';
  import SectionStrip from './lib/components/SectionStrip.svelte';
  import Builder from './lib/components/Builder.svelte';
  import TextEditor from './lib/components/TextEditor.svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import SharePanel from './lib/components/SharePanel.svelte';
  import LibraryPanel from './lib/components/LibraryPanel.svelte';
  import Icon from './lib/components/Icon.svelte';
  import GroupPanel from './lib/components/GroupPanel.svelte';
  import GroupBar from './lib/components/GroupBar.svelte';
  import PartsPanel from './lib/components/PartsPanel.svelte';
  import LatencyTest from './lib/components/LatencyTest.svelte';
  import { parseJoinLink, savedSession } from './lib/sync/session';

  let editorMode = $state<'builder' | 'text'>('builder');
  let showParts = $state(false);
  let showSettings = $state(false);
  let showShare = $state(false);
  let showLibrary = $state(false);
  let showKeys = $state(false);
  let showGroup = $state(false);
  let showLatency = $state(false);
  /** Room code from a join link, waiting for the user to tap Join. */
  let joinInvite = $state<{ code: string; hostKey?: string; server?: string } | null>(null);

  // Group sync needs the audio clock running; otherwise it may sleep when idle.
  $effect(() => {
    app.engine.setKeepAlive(!!app.group);
  });

  // Keep the engine's copy of the timeline and loop in step.
  $effect(() => {
    const tl = app.timeline;
    untrack(() => {
      app.engine.setTimeline(tl);
      // In a group, replay the cue log against the edited map.
      app.group?.recompute();
    });
  });
  $effect(() => {
    // A follower's own count-in still applies, so it changes the replay too.
    void app.settings.countIn.amount;
    void app.settings.countIn.unit;
    untrack(() => app.group?.recompute());
  });
  $effect(() => {
    const loop = app.loopRegion;
    const region = loop ? { ...loop } : null;
    const g = app.group;
    untrack(() => {
      if (!g) {
        app.engine.update({ loop: region });
      } else if (g.isLeader) {
        // While the group plays, the loop is shared as a cue; otherwise it's local until the next start.
        if (g.playback?.mode === 'playing') g.localLoopChanged(region);
        else app.engine.update({ loop: region });
      }
    });
  });

  // Mirror builder edits into the text view (but never rewrite text while it is being typed).
  $effect(() => {
    const text = app.projectText();
    if (!app.editingText && app.errors.length === 0) app.text = text;
  });

  // Keep the address bar shareable, and (leading a group) the room's copy of the project.
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const text = app.projectText(); // tracks every part deeply
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => app.updateUrl(), 400);
    const g = app.group;
    if (g?.isLeader && g.phase === 'live') untrack(() => g.queueProject(text));
  });

  // The other parts and the mix go to the audio engine as layers.
  $effect(() => {
    void app.partTimelines;
    void app.audible;
    void app.activeIndex;
    for (const p of app.project.parts) void [p.sound.timbre, p.sound.volume, p.sound.transpose];
    untrack(() => app.pushLayers());
  });

  // When the leader starts, get the room dialog out of the way so everyone sees the metronome.
  let lastStart: number | null = null;
  $effect(() => {
    const at = app.group?.playback?.startAt ?? null;
    if (at !== null && at !== lastStart) showGroup = false;
    lastStart = at;
  });

  $effect(() => {
    document.documentElement.dataset.theme = app.settings.theme;
  });

  $effect(() => {
    document.title = app.project.title ? `${app.project.title} · Metronome` : 'Metronome';
  });

  onMount(() => {
    const invite = parseJoinLink(location);
    if (invite) {
      joinInvite = invite;
      showGroup = true;
      history.replaceState(null, '', location.pathname);
    } else {
      const saved = savedSession();
      // Reloaded while in a room: rejoin (sound starts after a tap, see GroupBar).
      if (saved) app.joinGroup({ server: saved.server, code: saved.code }).catch(() => {});
    }
    app.loadFromLocation();
    const onHash = () => {
      // Only reload if the hash was changed externally (e.g. pasted link).
      app.loadFromLocation();
    };
    window.addEventListener('popstate', onHash);
    return () => window.removeEventListener('popstate', onHash);
  });

  function isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    if (t.tagName === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
    return false;
  }

  function onKey(e: KeyboardEvent) {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    // Let a focused select handle its own arrow/space keys.
    if ((e.target as HTMLElement).tagName === 'SELECT' && e.key !== ' ' && e.key !== 'Escape') return;
    // Page turners and foot pedals send these: treat as "tap" during a hold.
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) && app.tap()) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case ' ':
        e.preventDefault();
        // Stop a focused button from also "clicking" on key-up.
        (document.activeElement as HTMLElement | null)?.blur();
        app.toggle();
        break;
      case 'Escape':
        if (app.focus) app.setFocus(false);
        else app.stop();
        break;
      case 'e':
      case 'E':
        app.editorOpen = !app.editorOpen;
        break;
      case 'f':
      case 'F':
        app.setFocus(!app.focus);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        app.stepBar(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        app.stepBar(1);
        break;
      case '[':
        app.stepMark(-1);
        break;
      case ']':
        app.stepMark(1);
        break;
      case 'l':
      case 'L':
        if (!app.following) app.loopOn = !app.loopOn;
        break;
      case '+':
      case '=':
        app.setTempoPercent(app.settings.tempoPercent + 5);
        break;
      case '-':
        app.setTempoPercent(app.settings.tempoPercent - 5);
        break;
      case '0':
        app.setTempoPercent(100);
        break;
      case '?':
        showKeys = true;
        break;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header>
    <div class="brand">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 2h4l5 20H5zm1.5 2-1 4h3l-1-4zM12 9.5 16.6 4l1 .8-4.6 5.6.9 3.6h-3.8z" /></svg>
      <span>Metronome</span>
    </div>
    <div class="title" title={app.project.title}>{app.project.title || 'Untitled'}</div>
    <nav>
      <button class="pill" onclick={() => (showParts = true)} title="Parts: show, mute, solo, duplicate">
        <span class="pname">{app.project.parts.length > 1 ? app.activePart.name : 'Parts'}</span>
        {#if app.project.parts.length > 1}<span class="pcount">· {app.project.parts.length}</span>{/if}
      </button>
      <button class="pill" class:on={app.editorOpen} aria-pressed={app.editorOpen} onclick={() => (app.editorOpen = !app.editorOpen)}>
        Edit<span class="wide-only">piece</span>
      </button>
      <button class="pill" class:live={!!app.group} onclick={() => (showGroup = true)} title="Play together" aria-label="Play together">
        <Icon name="group" size={18} /><span class="wide-only">Play together</span>
      </button>
      <span class="sep" aria-hidden="true"></span>
      <button class="icon" onclick={() => (showLibrary = true)} title="Open / save" aria-label="Open / save"><Icon name="folder" /></button>
      <button class="icon" onclick={() => (showShare = true)} title="Share link" aria-label="Share"><Icon name="share" /></button>
      <button class="icon" onclick={() => (showSettings = true)} title="Settings" aria-label="Settings"><Icon name="settings" /></button>
      <button class="icon help" onclick={() => (showKeys = true)} title="Help and keyboard shortcuts" aria-label="Help"><Icon name="help" /></button>
    </nav>
  </header>

  <main class:editing={app.editorOpen}>
    {#if app.editorOpen}
      <aside class="editor">
        <div class="edhead">
          <label class="ptitle">
            <span class="sr">Title</span>
            <input type="text" placeholder="Untitled piece" bind:value={app.project.title} />
          </label>
          <div class="seg" role="tablist" aria-label="Editor mode">
            <button role="tab" aria-selected={editorMode === 'builder'} class:on={editorMode === 'builder'} onclick={() => (editorMode = 'builder')}>Blocks</button>
            <button role="tab" aria-selected={editorMode === 'text'} class:on={editorMode === 'text'} onclick={() => (editorMode = 'text')}>Text</button>
          </div>
          <button class="done" onclick={() => (app.editorOpen = false)}>Done</button>
        </div>
        {#if app.project.parts.length > 1 && editorMode === 'builder'}
          <div class="editing-part">
            Editing <b>{app.activePart.name}</b>
            {#if app.duplicates[app.activePart.name]}
              <span class="muted">· copied from {app.duplicates[app.activePart.name].from}; changes are marked</span>
            {/if}
          </div>
        {/if}
        <div class="editor-body">
          {#if editorMode === 'builder'}
            <Builder />
          {:else}
            <TextEditor />
          {/if}
        </div>
      </aside>
    {/if}

    <section class="player">
      {#if app.group}
        <GroupBar onopen={() => (showGroup = true)} />
      {/if}
      <Display />
      <SectionStrip />
      <Transport />
    </section>
  </main>
</div>

<Dialog bind:open={showParts} title="Parts"><PartsPanel /></Dialog>
<Dialog bind:open={showSettings} title="Settings"><SettingsPanel onlatency={() => (showLatency = true)} /></Dialog>
<Dialog bind:open={showShare} title="Share"><SharePanel /></Dialog>
<Dialog bind:open={showGroup} title="Play together"><GroupPanel bind:invite={joinInvite} onlatency={() => (showLatency = true)} /></Dialog>
<Dialog bind:open={showLatency} title="Measure latency">
  {#if showLatency}<LatencyTest onclose={() => (showLatency = false)} />{/if}
</Dialog>
<Dialog bind:open={showLibrary} title="Library"><LibraryPanel onclose={() => (showLibrary = false)} /></Dialog>
<Dialog bind:open={showKeys} title="Keyboard shortcuts">
  <table class="keys">
    <tbody>
      <tr><td><kbd>E</kbd></td><td>Edit the piece (open / close the editor)</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Play / pause · continue from a pause</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Stop and return to the start point</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Previous / next bar</td></tr>
      <tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>Previous / next rehearsal mark</td></tr>
      <tr><td><kbd>F</kbd></td><td>Focus view: just the click strip (Esc to leave)</td></tr>
      <tr><td><kbd>L</kbd></td><td>Loop on / off</td></tr>
      <tr><td><kbd>−</kbd> <kbd>+</kbd> <kbd>0</kbd></td><td>Tempo −5% / +5% / reset</td></tr>
      <tr><td><kbd>PgDn</kbd> <kbd>↓</kbd> <kbd>Enter</kbd></td><td>Continue from a pause (works with page-turner pedals)</td></tr>
    </tbody>
  </table>
  <p class="muted">Drag the display to move the start point, and pinch or Ctrl+scroll to zoom.</p>
</Dialog>

<style>
  .app {
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.75rem;
    padding-top: max(0.45rem, env(safe-area-inset-top));
    border-bottom: 1px solid var(--c-border);
    background: var(--c-surface);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--c-accent);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--c-muted);
  }
  nav {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill.on {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: var(--c-on-accent);
  }
  .pill.live {
    color: var(--c-accent);
    border-color: var(--c-accent);
  }
  .pname {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pcount {
    color: var(--c-muted);
  }
  .sep {
    width: 1px;
    height: 1.5rem;
    margin: 0 0.2rem;
    background: var(--c-border);
  }
  main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  main.editing {
    grid-template-columns: minmax(20rem, 26rem) minmax(0, 1fr);
  }
  .editor {
    border-right: 1px solid var(--c-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .edhead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.25rem;
  }
  .ptitle {
    flex: 1;
    min-width: 0;
  }
  .ptitle input {
    width: 100%;
    font-size: 1.1rem;
    font-weight: 700;
    border: 1px solid transparent;
    background: transparent;
    padding: 0.25rem 0.35rem;
  }
  .ptitle input:hover,
  .ptitle input:focus {
    border-color: var(--c-border);
    background: var(--c-surface);
  }
  .done {
    font-weight: 600;
  }
  .editing-part {
    padding: 0.1rem 1.1rem 0.3rem;
    font-size: 0.9rem;
  }
  .editor-body {
    flex: 1;
    overflow: auto;
    padding: 0.25rem 0.75rem 0;
  }
  .seg {
    display: flex;
    flex: none;
    background: var(--c-surface-2);
    padding: 2px;
    border-radius: 8px;
  }
  .seg button {
    border: none;
    background: none;
    padding: 0.2rem 0.65rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--c-muted);
  }
  .seg button.on {
    background: var(--c-surface);
    color: var(--c-fg);
    box-shadow: var(--shadow-sm);
  }
  .player {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 1rem;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
  }
  .keys td {
    padding: 0.3rem 1rem 0.3rem 0;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.8rem;
    border: 1px solid var(--c-border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 0.3rem;
    background: var(--c-surface);
  }
  .muted {
    color: var(--c-muted);
    font-size: 0.85rem;
    margin: 0;
  }
  /* Keyboard shortcuts mean little on touch screens. */
  @media (hover: none) and (pointer: coarse) {
    .help {
      display: none;
    }
  }
  @media (max-width: 860px) {
    /* Phones: the editor takes the whole screen while it is open. */
    main.editing {
      grid-template-columns: minmax(0, 1fr);
    }
    main.editing .player {
      display: none;
    }
    .editor {
      border-right: none;
    }
    header {
      gap: 0.4rem;
      padding-left: max(0.5rem, env(safe-area-inset-left));
      padding-right: max(0.25rem, env(safe-area-inset-right));
    }
    .title,
    .brand span,
    .wide-only {
      display: none;
    }
    nav {
      margin-left: auto;
    }
    .pill {
      padding: 0.35rem 0.7rem;
    }
    .pname {
      max-width: 5rem;
    }
    nav {
      gap: 0.2rem;
    }
    nav .icon {
      width: 2.1rem;
      padding: 0;
    }
    .sep {
      display: none;
    }
    .player {
      padding: 0.6rem 0.75rem;
      padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
  }
</style>
