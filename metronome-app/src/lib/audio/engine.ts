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
import type { WorkletMessage } from './worklet';

/** Lead time for ordinary changes (play, tempo, loop), seconds. */
const LEAD = 0.06;
/** Lead time for tap releases: as small as safely possible. */
const TAP_LEAD = 0.025;

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
  /** Extra display delay in seconds (user calibration). */
  visualOffset = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  /** Called whenever transport state changes. */
  onChange: () => void = () => {};

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
        if (this.sound) this.post({ type: 'sound', sound: this.sound });
      })();
    }
    await this.ready;
    if (this.ctx!.state !== 'running') await this.ctx!.resume();
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
        anchorScore: Math.min(this.scoreAt(t), tl.duration),
        end: tl.duration,
        holds: tl.holds,
        loop: clampLoop(this.state.loop, tl.duration),
        releaseAtAnchor: false,
      },
      false,
    );
    if (!playing) this.countIn = null;
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
    let t: number;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    } else {
      t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    return t - this.visualOffset;
  }

  position(t = this.audibleTime()): Position {
    return positionAt(this.state, t);
  }

  get playing() {
    return this.state.playing;
  }

  private apply(next: TransportState, notify = true) {
    this.state = withPrev(next, this.state);
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
      end: tl.duration,
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
  }

  /** Stop immediately and park at a score position. */
  park(score: number) {
    this.countIn = null;
    this.post({ type: 'silence' });
    this.state = { ...this.state, playing: false, anchorScore: score, anchorTime: this.now, prev: undefined };
    this.post({ type: 'state', state: this.state });
    this.onChange();
    this.releaseWakeLock();
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

  /** Continue from a tap-hold. Returns false if not currently held. */
  release(): boolean {
    const t = this.now + TAP_LEAD;
    const pos = positionAt(this.state, t);
    if (!this.state.playing || pos.frozen?.kind !== 'hold') return false;
    this.apply({ ...this.state, anchorTime: t, anchorScore: pos.frozen.at, releaseAtAnchor: true });
    return true;
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
