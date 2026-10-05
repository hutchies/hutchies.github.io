/**
 * A live group session: clock sync, the room's cue log, presence, and the
 * glue that turns the replayed cue log into engine state on this device.
 *
 * Every device, the leader's included, plays only what the cue log says, so
 * all devices take the same path. The leader's buttons publish cues instead of
 * acting locally (see AppState).
 */
import { positionAt, type LoopRegion } from '../audio/transport';
import { barAt, countIn, LEVEL_COUNT_BAR, LEVEL_COUNT_BEAT } from '../model/compile';
import type { AppState } from '../state/app.svelte';
import { ClockSync, type ClockEstimate } from './clock';
import {
  loopSpecFor,
  replay,
  shiftCountIn,
  shiftState,
  syncPointAt,
  type Cue,
  type CueKind,
  type GroupPlayback,
  type LoopSpec,
  type UpdatePayload,
} from './cues';
import {
  COUNTDOWN_SECONDS,
  DEFAULT_SERVER,
  errorMessage,
  forgetSession,
  normaliseCode,
  rememberSession,
  STALE_MS,
  type MemberKind,
} from './session';
import { randomKey, RoomApi, type MemberInfo, type RoomInfo } from './room';

const HEARTBEAT_MS = 10_000;
/** Lead time for stop, pause and tempo changes. */
const CHANGE_LEAD_MS = 400;
const MIN_START_LEAD_MS = 2500;
const START_MARGIN_MS = 1500;
/** Re-anchor playback when the audio/server clock mapping drifts by more than this (s). */
const DRIFT_TOLERANCE = 0.003;

const IDENTITY_KEY = 'metronome.groupIdentity';
const HOST_KEYS = 'metronome.hostKeys';

interface Identity {
  clientId: string;
  memberKey: string;
}

/** Per tab, so two tabs in one browser are two members. */
function identity(): Identity {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    /* fall through */
  }
  const id = { clientId: randomKey(9), memberKey: randomKey() };
  try {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* storage unavailable */
  }
  return id;
}

function hostKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HOST_KEYS) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberHostKey(code: string, key: string | null) {
  try {
    const keys = hostKeys();
    if (key) keys[code] = key;
    else delete keys[code];
    localStorage.setItem(HOST_KEYS, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export interface JoinOptions {
  server: string;
  kind: MemberKind;
  /** Join this room; omit to create a new one. */
  code?: string;
  /** Leader key (from a leader link, or remembered on this device). */
  hostKey?: string;
  /** For a new room: the map to share. */
  map?: string;
  name?: string;
}

export class GroupSession {
  phase = $state<'connecting' | 'live' | 'error' | 'left'>('connecting');
  error = $state('');
  room = $state<RoomInfo | null>(null);
  members = $state<MemberInfo[]>([]);
  clock = $state<ClockEstimate | null>(null);
  hostKey = $state<string | null>(null);
  kind = $state<MemberKind>('app');
  ready = $state(false);
  playback = $state.raw<GroupPlayback | null>(null);
  /** Countdown members: server ms of the next "go". */
  countdownAt = $state<number | null>(null);
  /** The AudioContext needs a tap before this device can play. */
  audioBlocked = $state(false);
  /** Bumped on every heartbeat, so "last seen" labels can re-render. */
  tick = $state(0);

  readonly server: string;
  readonly id = identity();
  private api: RoomApi;
  private clockSync: ClockSync;
  private cues = new Map<number, Cue>();
  private unsubscribe: (() => Promise<void>) | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** Recent samples of (audio time - server time), seconds. */
  private deltas: number[] = [];
  private appliedDelta: number | null = null;
  private precise = false;
  private pendingUpdate: UpdatePayload | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoop = 'null';
  /** Set once left (possibly while still connecting). */
  private closed = false;

  constructor(
    private app: AppState,
    private opts: JoinOptions,
  ) {
    this.server = opts.server;
    this.kind = opts.kind;
    this.api = new RoomApi(opts.server);
    this.clockSync = new ClockSync({ fetchTime: () => this.api.time() });
    this.clockSync.onUpdate = (e) => (this.clock = e);
  }

  get code(): string {
    return this.room?.code ?? '';
  }

  get isLeader(): boolean {
    return !!this.hostKey && !!this.room?.isHost;
  }

  get leaderMember(): MemberInfo | undefined {
    return this.members.find((m) => m.leader);
  }

  /** Members heard from recently. */
  get activeMembers(): MemberInfo[] {
    void this.tick;
    const now = Date.now();
    return this.members.filter((m) => now - Date.parse(m.updated.replace(' ', 'T')) < STALE_MS);
  }

  serverNow(): number {
    return this.clockSync.serverNow();
  }

  async connect(): Promise<void> {
    const o = this.opts;
    try {
      const clockReady = this.clockSync.start();
      if (o.code) {
        const code = normaliseCode(o.code);
        const key = o.hostKey || hostKeys()[code] || null;
        const room = await this.api.getRoom(code, key ?? undefined);
        this.hostKey = room.isHost ? key : null;
        if (o.hostKey && !room.isHost) this.error = 'That leader link is no longer valid; joined as a player.';
        this.room = room;
      } else {
        const key = randomKey();
        this.room = await this.api.createRoom(key, { name: o.name ?? '', map: o.map ?? '' });
        this.hostKey = key;
      }
      if (this.hostKey) rememberHostKey(this.code, this.hostKey);
      await clockReady;
      if (this.closed) return;
      const unsubscribe = await this.api.subscribe(
        this.room!,
        (cue) => this.addCues([cue]),
        () => void this.fetchCues(),
      );
      if (this.closed) {
        void unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      await this.fetchCues();
      await this.heartbeat();
      if (this.closed) return;
      this.phase = 'live';
      rememberSession({ server: this.server, code: this.code, kind: this.kind });
      this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS));
      this.timers.push(setInterval(() => this.checkDrift(), 1000));
    } catch (e) {
      this.phase = 'error';
      this.error = errorMessage(e);
      this.close();
      // The room has gone (expired): don't try to rejoin it on the next reload.
      if ((e as { status?: number }).status === 404) forgetSession();
      throw e;
    }
  }

  /** Leave the room. */
  async leave() {
    const code = this.code;
    this.close();
    this.phase = 'left';
    forgetSession();
    if (code) await this.api.leave(code, this.id.memberKey, this.id.clientId).catch(() => {});
    this.api.disconnect();
  }

  private close() {
    this.closed = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.clockSync.stop();
    if (this.updateTimer) clearTimeout(this.updateTimer);
    void this.unsubscribe?.();
    this.unsubscribe = null;
    this.app.engine.beeps([], []);
  }

  /* ---------------- cue log ---------------- */

  private async fetchCues() {
    if (!this.room) return;
    try {
      const last = Math.floor(Math.max(0, ...this.cues.keys()));
      this.addCues(await this.api.listCues(this.code, last));
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  private addCues(cues: Cue[]) {
    let changed = false;
    let roomChanged = false;
    for (const c of cues) {
      if (this.cues.has(c.seq)) continue;
      this.cues.set(c.seq, c);
      changed = true;
      if (c.kind === 'room') roomChanged = true;
    }
    if (roomChanged) void this.refreshRoom();
    if (changed) this.recompute();
  }

  private async refreshRoom() {
    try {
      this.room = await this.api.getRoom(this.code, this.hostKey ?? undefined);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Replays the cue log against the current map and applies it to the engine. */
  recompute() {
    if (!this.room || this.closed) return;
    if (this.kind === 'countdown') {
      this.updateCountdown();
      return;
    }
    const app = this.app;
    this.playback = replay(this.cues.values(), {
      timeline: app.timeline,
      countIn: $state.snapshot(app.settings.countIn),
    });
    this.apply();
  }

  /** Current (smoothed) offset from server seconds to this AudioContext's seconds. */
  private sampleDelta(): number {
    const engine = this.app.engine;
    // Samples from before the output timestamp was available are less precise: drop them.
    const precise = !!engine.outputTimestamp();
    if (precise !== this.precise) {
      this.precise = precise;
      this.deltas = [];
    }
    const perf = performance.now();
    const d = engine.contextTimeHeardAt(perf) - this.clockSync.toServer(perf) / 1000;
    this.deltas.push(d);
    if (this.deltas.length > 5) this.deltas.shift();
    return median(this.deltas);
  }

  private apply() {
    const p = this.playback;
    const app = this.app;
    const engine = app.engine;
    if (!p) return;
    if (!engine.running) {
      this.audioBlocked = true;
      return;
    }
    this.audioBlocked = false;
    const d = this.sampleDelta();
    this.appliedDelta = d;
    const state = shiftState(p.state, d);
    const now = engine.audibleTime();
    app.startPoint = p.home;
    if (p.mode === 'playing' && positionAt(state, now).frozen?.kind === 'end') {
      // This map has finished (maps can differ in length).
      engine.park(p.home);
      app.status = 'stopped';
      return;
    }
    engine.adopt(state, shiftCountIn(p.countIn, d));
    if (p.mode === 'playing') {
      const pending = now < state.anchorTime;
      if (pending) app.status = 'countin';
      else if (app.status !== 'held') app.status = 'playing';
    } else {
      app.status = p.mode;
    }
  }

  private checkDrift() {
    if (this.audioBlocked && this.app.engine.running) {
      this.recompute();
      return;
    }
    if (!this.app.engine.running) return;
    const d = this.sampleDelta();
    if (this.kind === 'countdown') {
      if (this.countdownAt && Math.abs(d - (this.appliedDelta ?? d)) > DRIFT_TOLERANCE) this.updateCountdown();
      return;
    }
    const p = this.playback;
    if (!p || p.mode !== 'playing' || this.appliedDelta === null) return;
    if (Math.abs(d - this.appliedDelta) <= DRIFT_TOLERANCE) return;
    // Don't resurrect a map that has reached its end.
    if (this.app.status === 'stopped') return;
    this.apply();
  }

  private updateCountdown() {
    let at: number | null = null;
    for (const c of [...this.cues.values()].sort((a, b) => a.seq - b.seq)) {
      if (c.kind === 'start') at = c.at;
      else if (c.kind === 'stop' || c.kind === 'pause') at = null;
    }
    this.countdownAt = at;
    const engine = this.app.engine;
    if (!engine.running) {
      this.audioBlocked = true;
      return;
    }
    this.audioBlocked = false;
    if (at === null || at < this.serverNow() - 1000) {
      engine.beeps([], []);
      return;
    }
    const d = this.sampleDelta();
    this.appliedDelta = d;
    const times: number[] = [];
    const levels: number[] = [];
    for (let k = COUNTDOWN_SECONDS; k >= 0; k--) {
      times.push((at - k * 1000) / 1000 + d);
      levels.push(k === 0 ? LEVEL_COUNT_BAR : LEVEL_COUNT_BEAT);
    }
    engine.beeps(times, levels);
  }

  /* ---------------- presence ---------------- */

  /** This device's count-in length at its current start point, seconds. */
  private countInSeconds(): number {
    if (this.kind === 'countdown') return COUNTDOWN_SECONDS;
    const app = this.app;
    const tl = app.timeline;
    if (!tl.bars.length) return 0;
    const rate = (this.isLeader ? app.settings.tempoPercent : (this.playback?.tempoPercent ?? 100)) / 100;
    return countIn(tl, Math.max(0, barAt(tl, app.startPoint)), app.settings.countIn).duration / rate;
  }

  async heartbeat() {
    if (!this.room) return;
    const s = this.app.settings;
    try {
      const res = await this.api.heartbeat(
        this.code,
        this.id.memberKey,
        {
          clientId: this.id.clientId,
          displayName: s.groupName,
          part: s.groupPart,
          kind: this.kind,
          ready: this.ready,
          rttMs: Math.round(this.clock?.rtt ?? 0),
          offsetErrMs: this.clock?.error ?? 0,
          countInSec: this.countInSeconds(),
        },
        this.hostKey ?? undefined,
      );
      this.members = res.members;
      if (res.room.updated !== this.room?.updated) this.room = { ...res.room, isHost: this.room?.isHost };
      this.tick++;
      if (this.error === 'Could not reach the sync server.') this.error = '';
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  setReady(ready: boolean) {
    this.ready = ready;
    void this.heartbeat();
  }

  /* ---------------- leader commands ---------------- */

  private async send(kind: CueKind, at: number, payload: object) {
    if (!this.hostKey || !this.room) return;
    try {
      const cue = await this.api.sendCue(this.code, this.hostKey, {
        kind,
        at: Math.round(at),
        payload,
        by: this.id.clientId,
      });
      // Apply straight away rather than waiting for the realtime echo.
      this.addCues([cue]);
      if (this.error) this.error = '';
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Lead time for a start: the longest count-in in the room, plus a network margin. */
  startLeadMs(from: number): number {
    const app = this.app;
    const tl = app.timeline;
    let longest = 0;
    if (tl.bars.length && this.kind === 'app') {
      longest = countIn(tl, Math.max(0, barAt(tl, from)), app.settings.countIn).duration / app.rate;
    }
    let rtt = this.clock?.rtt ?? 0;
    for (const m of this.activeMembers) {
      longest = Math.max(longest, m.countInSec || 0, m.kind === 'countdown' ? COUNTDOWN_SECONDS : 0);
      rtt = Math.max(rtt, m.rttMs || 0);
    }
    const margin = Math.max(START_MARGIN_MS, 3 * rtt + 500);
    return Math.min(55_000, Math.max(MIN_START_LEAD_MS, longest * 1000 + margin));
  }

  start(from: number) {
    const app = this.app;
    const tl = app.timeline;
    const loop = loopSpecFor(tl, app.loopRegion);
    this.lastLoop = JSON.stringify(loop);
    this.cancelUpdate();
    void this.send('start', this.serverNow() + this.startLeadMs(from), {
      sync: syncPointAt(tl, from),
      tempoPercent: app.settings.tempoPercent,
      loop,
    });
  }

  pause() {
    this.cancelUpdate();
    void this.send('pause', this.serverNow() + CHANGE_LEAD_MS, {});
  }

  stop() {
    this.cancelUpdate();
    void this.send('stop', this.serverNow() + CHANGE_LEAD_MS, {});
  }

  /** Continue from a tap pause, `releaseLeadMs` after the tap. */
  release() {
    void this.send('release', this.serverNow() + (this.room?.settings.releaseLeadMs ?? 250), {});
  }

  /**
   * A follower continues from a pause on their own, e.g. when their map
   * reaches a pause after the leader already released theirs. Kept as a local
   * entry in this device's cue log, slotted after the last cue received.
   */
  releaseLocally() {
    const seq = Math.max(0, ...this.cues.keys()) + 0.001;
    this.cues.set(seq, { seq, kind: 'release', at: this.serverNow() + 30, payload: {} });
    this.recompute();
  }

  seek(score: number) {
    void this.send('seek', this.serverNow(), { sync: syncPointAt(this.app.timeline, score) });
  }

  /** Tempo or loop change; rapid changes (a dragged slider) are coalesced. */
  update(change: UpdatePayload) {
    this.pendingUpdate = { ...this.pendingUpdate, ...change };
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const payload = this.pendingUpdate;
      this.pendingUpdate = null;
      if (payload) void this.send('update', this.serverNow() + CHANGE_LEAD_MS, payload);
    }, 120);
  }

  private cancelUpdate() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    this.pendingUpdate = null;
  }

  /** The leader changed the loop locally: share it if the group is playing. */
  localLoopChanged(region: LoopRegion | null) {
    if (!this.isLeader || this.playback?.mode !== 'playing') return;
    const spec: LoopSpec = loopSpecFor(this.app.timeline, region);
    const key = JSON.stringify(spec);
    if (key === this.lastLoop) return;
    this.lastLoop = key;
    this.update({ loop: spec });
  }

  async shareMap(text: string) {
    if (!this.hostKey) return;
    try {
      const room = await this.api.updateRoom(this.code, this.hostKey, { map: text, by: this.id.clientId });
      this.room = { ...room, isHost: true };
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async setReleaseLead(ms: number) {
    if (!this.hostKey || !this.room) return;
    try {
      const room = await this.api.updateRoom(this.code, this.hostKey, {
        settings: { ...this.room.settings, releaseLeadMs: ms },
        by: this.id.clientId,
      });
      this.room = { ...room, isHost: true };
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Link that joins this room. With `asLeader`, it carries the host key (handing over control). */
  joinLink(asLeader = false): string {
    const u = new URL(location.href);
    u.search = '';
    u.hash = `join=${this.code}` + (asLeader && this.hostKey ? `.${this.hostKey}` : '');
    if (this.server !== DEFAULT_SERVER) u.searchParams.set('server', this.server);
    return u.toString();
  }
}
