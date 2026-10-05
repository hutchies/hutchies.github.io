<script lang="ts">
  import { app } from '../state/app.svelte';
  import { serialize } from '../model/syntax';
  import { DEFAULT_SERVER, errorMessage, normaliseCode, STALE_MS, type MemberKind } from '../sync/session';

  let { invite = $bindable(null) }: { invite: { code: string; hostKey?: string; server?: string } | null } = $props();

  const s = app.settings;
  const save = () => app.persistSettings();

  let code = $state('');
  let kind = $state<MemberKind>('app');
  let shareMap = $state(true);
  let busy = $state(false);
  let error = $state('');
  let copied = $state('');
  let qrSvg = $state('');
  let showQr = $state(false);

  $effect(() => {
    if (invite) code = invite.code;
  });

  const g = $derived(app.group);

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  function create() {
    run(() =>
      app.joinGroup({
        kind,
        name: s.groupName ? `${s.groupName}'s room` : '',
        map: shareMap ? serialize(app.piece, { british: s.british }) : '',
      }),
    );
  }

  function join() {
    const c = normaliseCode(code);
    if (c.length !== 5) {
      error = 'Room codes have 5 letters and numbers.';
      return;
    }
    const inv = invite && invite.code === c ? invite : null;
    run(async () => {
      await app.joinGroup({ kind, code: c, hostKey: inv?.hostKey, server: inv?.server });
      invite = null;
    });
  }

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = what;
    setTimeout(() => (copied = ''), 1500);
  }

  async function toggleQr() {
    showQr = !showQr;
    if (showQr && g) {
      const { default: qrcode } = await import('qrcode-generator');
      const qr = qrcode(0, 'M');
      qr.addData(g.joinLink());
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }
  }

  function ago(updated: string): string {
    void g?.tick;
    const ms = Date.now() - Date.parse(updated.replace(' ', 'T'));
    return ms < STALE_MS ? '' : 'away';
  }

  const readyCount = $derived(g ? g.activeMembers.filter((m) => m.ready || m.leader).length : 0);
  /** This device's map is the one shared in the room. */
  const mapIsRooms = $derived(
    !!g?.room?.map && g.room.map.trim() === serialize(app.piece, { british: s.british }).trim(),
  );
</script>

<div class="group">
  {#if !g}
    <p>
      Start together with other players, each on their own device. Everyone's click lands on the same downbeat, even
      with different maps or count-ins. One person leads: their play, pause, tempo and pause-release buttons control
      everyone.
    </p>

    <div class="grid">
      <label for="g-name">Your name</label>
      <input id="g-name" type="text" maxlength="40" bind:value={s.groupName} onchange={save} placeholder="e.g. Sam" />
      <label for="g-part">Part</label>
      <input id="g-part" type="text" maxlength="40" bind:value={s.groupPart} onchange={save} placeholder="optional, e.g. Percussion" />
    </div>

    <fieldset>
      <legend>How will you play?</legend>
      <label><input type="radio" bind:group={kind} value="app" /> With this metronome (my own map and count-in)</label>
      <label><input type="radio" bind:group={kind} value="countdown" /> Countdown only: I'm using another metronome, or none</label>
    </fieldset>

    <section class="choice">
      <h3>Join a room</h3>
      <div class="row">
        <input
          type="text"
          class="code-in"
          maxlength="5"
          bind:value={code}
          placeholder="CODE"
          aria-label="Room code"
          autocapitalize="characters"
          onkeydown={(e) => e.key === 'Enter' && join()}
        />
        <button class="primary" onclick={join} disabled={busy}>
          {invite?.hostKey && invite.code === normaliseCode(code) ? 'Join as leader' : 'Join'}
        </button>
      </div>
    </section>

    <section class="choice">
      <h3>Or start a new room</h3>
      <label class="check"><input type="checkbox" bind:checked={shareMap} /> Share my current map with the room</label>
      <button onclick={create} disabled={busy}>Create room and lead</button>
    </section>

    <details>
      <summary>Server</summary>
      <p class="note">
        The PocketBase server that relays start times and keeps the shared clock. A band can run its own (see the app's
        README).
      </p>
      <input type="text" class="server" bind:value={s.syncServer} onchange={save} placeholder={DEFAULT_SERVER} aria-label="Sync server" />
    </details>
  {:else}
    <div class="head">
      <div>
        <div class="k">Room</div>
        <div class="big">{g.code || '…'}</div>
      </div>
      <div class="links">
        <button onclick={() => copy(g.joinLink(), 'link')}>{copied === 'link' ? 'Copied!' : 'Copy invite link'}</button>
        <button onclick={toggleQr}>{showQr ? 'Hide QR code' : 'QR code'}</button>
        {#if g.isLeader}
          <button onclick={() => copy(g.joinLink(true), 'lead')} title="Anyone who opens this link can control playback">
            {copied === 'lead' ? 'Copied!' : 'Copy leader link'}
          </button>
        {/if}
      </div>
    </div>
    {#if showQr && qrSvg}
      <div class="qr">{@html qrSvg}</div>
    {/if}

    <p class="status">
      {#if g.phase === 'connecting'}
        Connecting…
      {:else if g.isLeader}
        <strong>You lead.</strong> Play, pause, stop, tempo, loop and pause-release on this device control everyone.
      {:else}
        <strong>Following {g.leaderMember?.displayName || 'the leader'}.</strong> Your own map and count-in still apply.
      {/if}
      {#if g.clock}
        Clock sync ±{Math.max(1, Math.round(g.clock.error))} ms (round trip {Math.round(g.clock.rtt)} ms).
      {/if}
    </p>

    {#if g.error}<p class="err">{g.error}</p>{/if}

    <table class="members">
      <thead>
        <tr><th>Player</th><th>Part</th><th>Ready</th><th>Sync</th></tr>
      </thead>
      <tbody>
        {#each g.members as m (m.clientId)}
          <tr class:me={m.clientId === g.id.clientId} class:away={ago(m.updated) === 'away'}>
            <td>
              {m.displayName || 'Anonymous'}
              {#if m.leader}<span class="tag lead">leader</span>{/if}
              {#if m.kind === 'countdown'}<span class="tag">countdown</span>{/if}
              {#if m.clientId === g.id.clientId}<span class="tag">you</span>{/if}
              {#if ago(m.updated)}<span class="tag">away</span>{/if}
            </td>
            <td>{m.part}</td>
            <td>{m.leader ? '–' : m.ready ? '✓' : ''}</td>
            <td class="num">{m.offsetErrMs ? `±${Math.max(1, Math.round(m.offsetErrMs))} ms` : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if g.isLeader}
      <p class="muted">{readyCount} of {g.activeMembers.length} ready.</p>
      <div class="grid">
        <span>Shared map</span>
        <div class="row">
          <button onclick={() => g.shareMap(serialize(app.piece, { british: s.british }))} disabled={mapIsRooms}>
            {mapIsRooms ? 'Your map is shared' : 'Share my map with the room'}
          </button>
        </div>
        <label for="g-rel">Pause release delay</label>
        <div class="row">
          <input
            id="g-rel"
            type="range"
            min="50"
            max="800"
            step="10"
            value={g.room?.settings.releaseLeadMs ?? 250}
            onchange={(e) => g.setReleaseLead(Number(e.currentTarget.value))}
          />
          <span class="num">{g.room?.settings.releaseLeadMs ?? 250} ms</span>
        </div>
      </div>
      <p class="note">
        When you tap to continue from a pause, everyone (you included) continues this long after your tap, so the
        message reaches every device in time. Lower it on a fast local network.
      </p>
    {:else}
      <div class="grid">
        <label for="g-part2">Part</label>
        <input id="g-part2" type="text" maxlength="40" bind:value={s.groupPart} onchange={() => { save(); g.heartbeat(); }} />
        <span>Ready?</span>
        <label class="check"><input type="checkbox" checked={g.ready} onchange={(e) => g.setReady(e.currentTarget.checked)} /> I'm ready</label>
      </div>
      {#if g.room?.map}
        <div class="row">
          <button onclick={() => app.loadText(g.room!.map)} class:primary={!mapIsRooms} disabled={mapIsRooms}>
            {mapIsRooms ? "You have the room's map" : "Load the room's map"}
          </button>
          <span class="note">Replaces your current map with the one the leader shared.</span>
        </div>
      {/if}
    {/if}

    <div class="row end">
      <button class="danger" onclick={() => app.leaveGroup()}>Leave room</button>
    </div>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  p {
    margin: 0;
  }
  h3 {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--c-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: 9rem 1fr;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  fieldset {
    border: 1px solid var(--c-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.75rem;
  }
  legend {
    color: var(--c-muted);
    font-size: 0.85rem;
    padding: 0 0.3rem;
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .row.end {
    justify-content: flex-end;
  }
  .code-in {
    width: 7rem;
    font-family: var(--mono);
    font-size: 1.2rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .server {
    width: 100%;
    font-family: var(--mono);
  }
  .check {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .k {
    color: var(--c-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .big {
    font-family: var(--mono);
    font-size: 2.2rem;
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  .links {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .qr {
    align-self: center;
    width: min(16rem, 70vw);
    background: #fff;
    padding: 0.5rem;
    border-radius: 8px;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
  .members {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .members th {
    text-align: left;
    color: var(--c-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--c-border);
    padding: 0.2rem 0.4rem 0.2rem 0;
  }
  .members td {
    padding: 0.3rem 0.4rem 0.3rem 0;
    border-bottom: 1px solid var(--c-surface-2);
  }
  .members tr.me td {
    font-weight: 600;
  }
  .members tr.away td {
    opacity: 0.5;
  }
  .tag {
    font-size: 0.7rem;
    font-weight: 600;
    border: 1px solid var(--c-border);
    border-radius: 4px;
    padding: 0 0.3rem;
    margin-left: 0.3rem;
    color: var(--c-muted);
  }
  .tag.lead {
    color: var(--c-accent);
    border-color: var(--c-accent);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .note,
  .muted {
    font-size: 0.85rem;
    color: var(--c-muted);
  }
  .err {
    color: var(--c-danger);
  }
  button.danger {
    color: var(--c-danger);
  }
  details summary {
    cursor: pointer;
    color: var(--c-accent);
  }
  details[open] {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  @media (max-width: 500px) {
    .grid {
      grid-template-columns: 1fr;
      gap: 0.25rem;
    }
  }
</style>
