/**
 * Main-thread side of the audio engine. Owns the AudioContext and the
 * worklet node, and is the single source of transport state changes: each
 * change is stamped with a future anchorTime, sent to the worklet, and kept
 * here for the display, so both read the same deterministic timeline.
 */
import workletUrl from './worklet.ts?worker&url';
import type { Timeline } from '../model/compile';
import type { SoundConfig } from './sounds';
import {
  positionAt,
  STOPPED,
  withPrev,
  type LoopRegion,
  type Position,
  type TransportState,
} from './transport';
import type { LayerTrack, TrackMix, WorkletMessage } from './worklet';

/** Lead time for ordinary changes (play, tempo, loop), seconds. */
const LEAD = 0.06;
/** Lead time for tap releases: as small as safely possible. */
const TAP_LEAD = 0.025;
/** Idle time after stopping before the audio thread is suspended. */
const IDLE_SUSPEND_MS = 5000;

export interface CountInInfo {
  /** Audio times of count-in clicks. */
  times: number[];
  levels: number[];
  /** Audio time the music proper starts. */
  startTime: number;
  startScore: number;
  rate: number;
}

export class Engine {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private ready: Promise<void> | null = null;
  state: TransportState = STOPPED;
  countIn: CountInInfo | null = null;
  private timeline: Timeline | null = null;
  private sound: SoundConfig | null = null;
  private layers: { main: TrackMix; layers: LayerTrack[] } | null = null;
  /** Score time (active part) until which other parts keep playing, e.g. an indefinite one. */
  private layersEnd = 0;
  /** Extra display delay in seconds (user calibration). */
  visualOffset = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  /** Called whenever transport state changes. */
  onChange: () => void = () => {};
  /**
   * Keep the audio clock running while idle (group sync needs it). Otherwise
   * the AudioContext is suspended a few seconds after playback stops, so a
   * stopped metronome uses next to no battery.
   */
  keepAlive = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Must be called from a user gesture the first time (autoplay policy). */
  async start(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        // iOS: play through the silent switch.
        const nav = navigator as Navigator & { audioSession?: { type: string } };
        if (nav.audioSession) nav.audioSession.type = 'playback';
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;
        await ctx.audioWorklet.addModule(workletUrl);
        this.node = new AudioWorkletNode(ctx, 'metronome-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node.connect(ctx.destination);
        if (this.timeline) this.sendTimeline(this.timeline);
        if (this.layers) this.setLayers(this.layers.main, this.layers.layers, this.layersEnd);
        if (this.sound) this.post({ type: 'sound', sound: this.sound });
      })();
    }
    await this.ready;
    clearTimeout(this.idleTimer);
    if (this.ctx!.state !== 'running') await this.ctx!.resume();
  }

  /** Suspend the audio thread once nothing is playing for a while. */
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.state.playing || this.keepAlive) return;
    this.idleTimer = setTimeout(() => {
      if (this.state.playing || this.keepAlive || this.ctx?.state !== 'running') return;
      void this.ctx.suspend();
    }, IDLE_SUSPEND_MS);
  }

  /** Allow or stop idle suspension (e.g. when joining or leaving a group). */
  setKeepAlive(on: boolean) {
    this.keepAlive = on;
    if (on) {
      clearTimeout(this.idleTimer);
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    } else {
      this.scheduleIdle();
    }
  }

  private post(msg: WorkletMessage, transfer: Transferable[] = []) {
    this.node?.port.postMessage(msg, transfer);
  }

  private sendTimeline(tl: Timeline) {
    // Copies, because transferring would detach the arrays the display uses.
    this.post({
      type: 'timeline',
      times: tl.clickTimes.slice(),
      levels: tl.clickLevels.slice(),
    });
  }

  setTimeline(tl: Timeline) {
    this.timeline = tl;
    this.sendTimeline(tl);
    // Keep the transport's piece-dependent fields in step.
    const t = this.now + LEAD;
    const playing = this.state.playing && !positionAt(this.state, t).pending;
    this.apply(
      {
        ...this.state,
        playing,
        anchorTime: t,
        anchorScore: Math.min(this.scoreAt(t), this.endOf(tl)),
        end: this.endOf(tl),
        holds: tl.holds,
        loop: clampLoop(this.state.loop, tl.duration),
        releaseAtAnchor: false,
      },
      false,
    );
    if (!playing) this.countIn = null;
  }

  /** Other parts to play alongside the timeline, and how the main part sounds. */
  private endOf(tl: Timeline) {
    return Math.max(tl.duration, this.layersEnd);
  }

  /**
   * `end`: active-part score time until which the other parts need playback
   * to continue (so an indefinite part keeps going after the active one ends).
   */
  setLayers(main: TrackMix, layers: LayerTrack[], end = 0) {
    this.layers = { main, layers };
    if (end !== this.layersEnd) {
      this.layersEnd = end;
      if (this.timeline) this.apply({ ...this.state, end: this.endOf(this.timeline) }, false);
    }
    // Copies, because transferring would detach the arrays the app keeps.
    this.post({
      type: 'layers',
      main,
      layers: layers.map((l) => ({ ...l, times: l.times.slice(), levels: l.levels.slice() })),
    });
  }

  setSound(sound: SoundConfig) {
    this.sound = sound;
    this.post({ type: 'sound', sound });
  }

  /** Current render time (what the worklet is about to produce). */
  get now(): number {
    return this.ctx?.currentTime ?? performance.now() / 1000;
  }

  /** The AudioContext time currently reaching the listener's ears. */
  audibleTime(): number {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return this.now - this.visualOffset;
    return this.contextTimeHeardAt(performance.now());
  }

  /**
   * The AudioContext time whose output is heard at a given performance.now()
   * time (ms), allowing for output latency and the user's calibration.
   */
  contextTimeHeardAt(perfMs: number): number {
    const ctx = this.ctx;
    if (!ctx) return perfMs / 1000 - this.visualOffset;
    let t: number;
    const ts = this.outputTimestamp();
    if (ts) {
      t = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    } else {
      t = ctx.currentTime + (perfMs - performance.now()) / 1000 - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    return t - this.visualOffset;
  }

  /**
   * The context's output timestamp, once the browser provides a usable one
   * (shortly after the context starts). Until then the latency estimate is
   * coarser.
   */
  outputTimestamp(): { contextTime: number; performanceTime: number } | null {
    const ts = this.ctx?.getOutputTimestamp?.();
    if (!ts || ts.contextTime === undefined || ts.performanceTime === undefined || !(ts.contextTime > 0)) return null;
    // Just after the context starts, some browsers pair the context time with
    // a stale (or zero) performance time: treat that as not ready yet.
    if (!(ts.performanceTime > 0) || Math.abs(performance.now() - ts.performanceTime) > 1000) return null;
    return { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
  }

  /**
   * The performance.now() time (ms) at which output at a given AudioContext
   * time is heard, by the browser's own latency estimate (no calibration).
   */
  perfTimeHeardAt(contextTime: number): number {
    const ctx = this.ctx;
    const ts = this.outputTimestamp();
    if (ts) return ts.performanceTime + (contextTime - ts.contextTime) * 1000;
    if (!ctx) return contextTime * 1000;
    return performance.now() + (contextTime - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
  }

  /** True once the AudioContext exists and is running. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  position(t = this.audibleTime()): Position {
    return positionAt(this.state, t);
  }

  get playing() {
    return this.state.playing;
  }

  private apply(next: TransportState, notify = true) {
    // A suspended clock never reaches the anchor, so idle changes apply at once.
    this.state = this.running ? withPrev(next, this.state) : { ...next, prev: undefined };
    this.post({ type: 'state', state: this.state });
    if (notify) this.onChange();
  }

  /** Position the next change should start from, evaluated at its anchor time. */
  private scoreAt(t: number): number {
    return positionAt(this.state, t).score;
  }

  async play(opts: {
    from: number;
    rate: number;
    loop: LoopRegion | null;
    countIn: { offsets: number[]; levels: number[]; duration: number };
  }) {
    await this.start();
    const tl = this.timeline;
    if (!tl) return;
    const rate = opts.rate;
    const t0 = this.now + LEAD + 0.04;
    const startTime = t0 + opts.countIn.duration / rate;
    const times = opts.countIn.offsets.map((o) => startTime + o / rate);
    this.countIn = times.length
      ? { times, levels: opts.countIn.levels, startTime, startScore: opts.from, rate }
      : null;
    this.post({ type: 'preroll', times, levels: opts.countIn.levels });
    this.state = { ...this.state, playing: false, anchorScore: opts.from, prev: undefined };
    this.apply({
      playing: true,
      anchorTime: startTime,
      anchorScore: opts.from,
      rate,
      // Starting exactly on a tap-hold means "go", not "wait again".
      releaseAtAnchor: true,
      loop: clampLoop(opts.loop, tl.duration),
      end: this.endOf(tl),
      holds: tl.holds,
    });
    this.requestWakeLock();
  }

  pause() {
    const t = this.now + LEAD;
    const score = this.scoreAt(t);
    this.countIn = null;
    this.post({ type: 'preroll', times: [], levels: [] });
    this.apply({ ...this.state, playing: false, anchorScore: score, anchorTime: t });
    this.releaseWakeLock();
    this.scheduleIdle();
  }

  /** Stop immediately and park at a score position. */
  park(score: number) {
    this.countIn = null;
    this.post({ type: 'silence' });
    this.state = { ...this.state, playing: false, anchorScore: score, anchorTime: this.now, prev: undefined };
    this.post({ type: 'state', state: this.state });
    this.onChange();
    this.releaseWakeLock();
    this.scheduleIdle();
  }

  /** Change tempo rate, loop region, etc. while keeping position continuous. */
  update(changes: { rate?: number; loop?: LoopRegion | null }) {
    const tl = this.timeline;
    const rate = changes.rate ?? this.state.rate;
    const loop = changes.loop !== undefined ? clampLoop(changes.loop, tl?.duration ?? 0) : this.state.loop;
    const t = this.now + LEAD;
    if (!this.state.playing) {
      this.apply({ ...this.state, anchorTime: t, rate, loop });
      return;
    }
    const pos = positionAt(this.state, t);
    if (pos.pending) {
      // Still counting in: keep the start, adopt the new loop. (The count-in
      // clicks are already scheduled, so the rate applies from the downbeat.)
      this.apply({ ...this.state, rate, loop });
      return;
    }
    let score = pos.score;
    // A loop that is already behind us would never trigger: jump into it.
    if (loop && changes.loop !== undefined && score >= loop.end) score = loop.start;
    this.apply({ ...this.state, anchorTime: t, anchorScore: score, rate, loop, releaseAtAnchor: false });
  }

  /**
   * Continue from a tap-hold, after an upbeat if `upbeat` gives one (from
   * `resumeCountIn`, which needs the hold's score time: see `heldAt`).
   * Returns false if not currently held.
   */
  release(upbeat?: { offsets: number[]; levels: number[]; duration: number }): boolean {
    const t = this.now + TAP_LEAD;
    const pos = positionAt(this.state, t);
    if (!this.state.playing || pos.frozen?.kind !== 'hold') return false;
    const rate = this.state.rate;
    const startTime = t + (upbeat?.duration ?? 0) / rate;
    const times = upbeat ? upbeat.offsets.map((o) => startTime + o / rate) : [];
    this.countIn = times.length
      ? { times, levels: upbeat!.levels, startTime, startScore: pos.frozen.at, rate }
      : null;
    this.post({ type: 'preroll', times, levels: upbeat?.levels ?? [] });
    this.apply({ ...this.state, anchorTime: startTime, anchorScore: pos.frozen.at, releaseAtAnchor: true });
    return true;
  }

  /** Score time of the tap-hold playback is waiting at, if any. */
  heldAt(): number | null {
    const pos = positionAt(this.state, this.now + TAP_LEAD);
    return this.state.playing && pos.frozen?.kind === 'hold' ? pos.frozen.at : null;
  }

  /**
   * Adopts a transport state computed elsewhere (group sync), with its times
   * already in this AudioContext's clock. The count-in, if any, replaces the
   * current one.
   */
  adopt(state: TransportState, countIn: CountInInfo | null) {
    this.countIn = countIn && countIn.times.length ? countIn : null;
    this.post({ type: 'preroll', times: countIn?.times ?? [], levels: countIn?.levels ?? [] });
    this.state = state;
    this.post({ type: 'state', state });
    this.onChange();
    if (state.playing) this.requestWakeLock();
    else this.releaseWakeLock();
    this.scheduleIdle();
  }

  /** Schedules standalone clicks at absolute audio times (e.g. a countdown). */
  beeps(times: number[], levels: number[]) {
    this.countIn = null;
    this.post({ type: 'preroll', times, levels });
  }

  private async requestWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
    } catch {
      /* not allowed; fine */
    }
  }

  private releaseWakeLock() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}

function clampLoop(loop: LoopRegion | null, duration: number): LoopRegion | null {
  if (!loop) return null;
  const start = Math.max(0, Math.min(loop.start, duration));
  const end = Math.max(start, Math.min(loop.end, duration));
  return end - start > 1e-6 ? { start, end } : null;
}
