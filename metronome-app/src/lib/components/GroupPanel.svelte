<script lang="ts">
  import { app } from '../state/app.svelte';
  import { DEFAULT_SERVER, errorMessage, normaliseCode, STALE_MS } from '../sync/session';
  import Icon from './Icon.svelte';

  let {
    invite = $bindable(null),
    onlatency,
  }: { invite: { code: string; hostKey?: string; server?: string } | null; onlatency: () => void } = $props();

  const s = app.settings;
  const save = () => app.persistSettings();

  let code = $state('');
  let busy = $state(false);
  let error = $state('');
  let copied = $state('');
  let qrSvg = $state('');
  let showQr = $state(false);

  $effect(() => {
    if (invite) code = invite.code;
  });

  const g = $derived(app.group);
  const partNames = $derived(app.project.parts.map((p) => p.name));
  const playing = $derived(app.status === 'playing' || app.status === 'countin' || app.status === 'held');

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
        name: s.groupName ? `${s.groupName}'s room` : '',
        map: app.projectText(),
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
      await app.joinGroup({ code: c, hostKey: inv?.hostKey, server: inv?.server });
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

  function away(updated: string): boolean {
    void g?.tick;
    return Date.now() - Date.parse(updated.replace(' ', 'T')) >= STALE_MS;
  }

  const readyCount = $derived(g ? g.activeMembers.filter((m) => m.ready || m.leader).length : 0);
</script>

<div class="group">
  {#if !g}
    <p>
      Start together with other players, each on their own device, accurate to a few milliseconds. One person leads:
      they set the maps (one part per player, if you like) and their play, pause, tempo and pause-release control
      everyone.
    </p>

    <div class="grid">
      <label for="g-name">Your name</label>
      <input id="g-name" type="text" maxlength="40" bind:value={s.groupName} onchange={save} placeholder="e.g. Sam" />
    </div>

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
      <h3>Or start a new room and lead</h3>
      <p class="note">Everyone in the room gets your maps ({partNames.length === 1 ? 'one part' : `${partNames.length} parts`}). You can keep editing them and give each player a part.</p>
      <button onclick={create} disabled={busy}>Create room</button>
    </section>

    <p class="note">
      Using Bluetooth headphones or speakers? <button class="link" onclick={onlatency}>Measure your latency</button> first,
      so your clicks land with everyone else's.
    </p>

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

    {#if g.isLeader && g.phase === 'live'}
      <div class="transport">
        {#if playing}
          <button class="primary big-btn" onclick={() => app.pause()}><Icon name="pause" /> Pause everyone</button>
        {:else}
          <button class="primary big-btn" onclick={() => app.play()}><Icon name="play" /> {app.status === 'paused' ? 'Continue' : 'Start everyone'}</button>
        {/if}
        <button class="big-btn" onclick={() => app.stop()}><Icon name="stop" /> Stop</button>
        <span class="note">{readyCount} of {g.activeMembers.length} ready</span>
      </div>
    {/if}

    <p class="status">
      {#if g.phase === 'connecting'}
        Connecting…
      {:else if g.isLeader}
        <strong>You lead.</strong> Your maps are shared with the room as you edit them; give each player a part below.
      {:else}
        <strong>Following {g.leaderMember?.displayName || 'the leader'}</strong>, playing
        <strong>{app.activePart.name}</strong>. The leader sets the maps and your part.
      {/if}
      {#if g.clock}
        Clock sync ±{Math.max(1, Math.round(g.clock.error))} ms.
      {/if}
    </p>

    {#if g.error}<p class="err">{g.error}</p>{/if}

    <table class="members">
      <thead>
        <tr><th>Player</th><th>Part</th><th>Ready</th><th>Sync</th></tr>
      </thead>
      <tbody>
        {#each g.members as m (m.clientId)}
          <tr class:me={m.clientId === g.id.clientId} class:away={away(m.updated)}>
            <td>
              {m.displayName || 'Anonymous'}
              {#if m.leader}<span class="tag lead">leader</span>{/if}
              {#if m.clientId === g.id.clientId}<span class="tag">you</span>{/if}
              {#if away(m.updated)}<span class="tag">away</span>{/if}
            </td>
            <td>
              {#if g.isLeader && !m.leader && partNames.length > 1}
                <select
                  value={g.partOf(m) || partNames[0]}
                  onchange={(e) => g.assign(m.clientId, e.currentTarget.value)}
                  aria-label="Part for {m.displayName || 'Anonymous'}"
                >
                  {#each partNames as n}<option value={n}>{n}</option>{/each}
                </select>
              {:else}
                {m.leader ? m.part : g.partOf(m) || partNames[0]}
              {/if}
            </td>
            <td>{m.leader ? '–' : m.ready ? '✓' : ''}</td>
            <td class="num">{m.offsetErrMs ? `±${Math.max(1, Math.round(m.offsetErrMs))} ms` : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if g.isLeader && partNames.length === 1}
      <p class="note">To give players different maps, add parts (+ Add part, above the display).</p>
    {/if}

    {#if g.isLeader}
      <div class="grid">
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
      <label class="check"><input type="checkbox" checked={g.ready} onchange={(e) => g.setReady(e.currentTarget.checked)} /> I'm ready</label>
    {/if}

    <div class="row end">
      <button class="link" onclick={onlatency}>Measure my latency</button>
      <span class="spacer"></span>
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
  .spacer {
    flex: 1;
  }
  .transport {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .big-btn {
    font-size: 1.05rem;
    padding: 0.5rem 1rem;
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
  .note {
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
