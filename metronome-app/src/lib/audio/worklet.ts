/**
 * AudioWorklet processor: runs on the audio rendering thread, so main-thread
 * jank (layout, GC, a busy UI) can never delay a click. Clicks are synthesised
 * here with sample-accurate placement, driven by the shared transport maths.
 */
import { lowerBound } from '../model/compile';
import { DEFAULT_SOUND, type SoundConfig, type Timbre } from './sounds';
import { pieces, STOPPED, type TransportState } from './transport';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** How one part sounds: overrides on top of the global sound settings. */
export interface TrackMix {
  /** null = the global timbre. */
  timbre: Timbre | null;
  /** Multiplies the level gains and volume; 0 silences the part. */
  gain: number;
  /** Multiplies the level pitches. */
  pitchMul: number;
}

/**
 * Another part played alongside the main timeline. Its click at score time
 * `s` sounds when the main transport reaches `s - offset`.
 */
export interface LayerTrack extends TrackMix {
  times: Float64Array;
  levels: Uint8Array;
  offset: number;
}

const PLAIN: TrackMix = { timbre: null, gain: 1, pitchMul: 1 };

export type WorkletMessage =
  | { type: 'timeline'; times: Float64Array; levels: Uint8Array }
  | { type: 'layers'; main: TrackMix; layers: LayerTrack[] }
  | { type: 'state'; state: TransportState }
  | { type: 'preroll'; times: number[]; levels: number[] }
  | { type: 'sound'; sound: SoundConfig }
  | { type: 'silence' };

interface Voice {
  /** Samples until the voice starts (within the current block). */
  delay: number;
  age: number;
  length: number;
  gain: number;
  pitch: number;
  timbre: Timbre;
  phase: number;
  phase2: number;
  noise: number;
  lp: number;
}

/** How late (seconds) a click may be and still be played immediately. */
const LATE_TOLERANCE = 0.04;

class MetronomeProcessor extends AudioWorkletProcessor {
  private times: Float64Array = new Float64Array(0);
  private levels: Uint8Array = new Uint8Array(0);
  private state: TransportState = STOPPED;
  private prerollTimes: number[] = [];
  private prerollLevels: number[] = [];
  private sound: SoundConfig = DEFAULT_SOUND;
  private mainMix: TrackMix = PLAIN;
  private layers: LayerTrack[] = [];
  private voices: Voice[] = [];
  /** Audio time up to which clicks have been scheduled. */
  private scheduledTo = 0;
  private seed = 12345;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onMessage(e.data);
  }

  private onMessage(msg: WorkletMessage) {
    switch (msg.type) {
      case 'timeline':
        this.times = msg.times;
        this.levels = msg.levels;
        break;
      case 'state': {
        this.state = msg.state;
        // If the message arrived a little late, re-scan from the anchor so the
        // clicks it implies are played (immediately) rather than lost.
        const a = msg.state.anchorTime;
        if (a < this.scheduledTo && a > this.scheduledTo - LATE_TOLERANCE) this.scheduledTo = a;
        break;
      }
      case 'layers':
        this.mainMix = msg.main;
        this.layers = msg.layers;
        break;
      case 'preroll':
        this.prerollTimes = msg.times;
        this.prerollLevels = msg.levels;
        break;
      case 'sound':
        this.sound = msg.sound;
        break;
      case 'silence':
        this.voices = [];
        this.prerollTimes = [];
        this.prerollLevels = [];
        break;
    }
  }

  private trigger(level: number, delay: number, mix: TrackMix = PLAIN) {
    const lv = this.sound.levels[level];
    if (!lv || lv.gain <= 0 || mix.gain <= 0) return;
    const timbre = mix.timbre ?? this.sound.timbre;
    const dur = timbre === 'bell' ? 0.25 : timbre === 'beep' ? 0.06 : timbre === 'wood' ? 0.05 : 0.02;
    this.voices.push({
      delay,
      age: 0,
      length: Math.ceil(dur * sampleRate),
      gain: lv.gain * this.sound.volume * mix.gain,
      pitch: lv.pitch * mix.pitchMul,
      timbre,
      phase: 0,
      phase2: 0,
      noise: 0,
      lp: 0,
    });
  }

  private schedule(blockStart: number, blockEnd: number) {
    const from = Math.min(this.scheduledTo, blockStart);
    const to = blockEnd;
    const offsetOf = (t: number) => Math.max(0, Math.round((t - blockStart) * sampleRate));

    // Count-in clicks are in absolute audio time.
    for (let i = 0; i < this.prerollTimes.length; i++) {
      const t = this.prerollTimes[i];
      if (t >= from && t < to) this.trigger(this.prerollLevels[i], offsetOf(t));
    }

    for (const p of pieces(this.state, from, to)) {
      const a = Math.max(p.t0, from);
      const b = Math.min(p.t1, to);
      if (b <= a) continue;
      const sA = p.s0 + (a - p.t0) * p.rate;
      const sB = p.s0 + (b - p.t0) * p.rate;
      for (let i = lowerBound(this.times, sA - 1e-9); i < this.times.length; i++) {
        const s = this.times[i];
        if (s >= sB - 1e-9) break;
        const t = p.t0 + (s - p.s0) / p.rate;
        this.trigger(this.levels[i], offsetOf(t), this.mainMix);
      }
      // Other parts, shifted to line up with the main one.
      for (const L of this.layers) {
        const lA = sA + L.offset;
        const lB = sB + L.offset;
        for (let i = lowerBound(L.times, lA - 1e-9); i < L.times.length; i++) {
          const s = L.times[i];
          if (s >= lB - 1e-9) break;
          const t = p.t0 + (s - L.offset - p.s0) / p.rate;
          this.trigger(L.levels[i], offsetOf(t), L);
        }
      }
    }
    this.scheduledTo = to;
  }

  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const n = out[0].length;
    const blockStart = currentTime;
    this.schedule(blockStart, blockStart + n / sampleRate);

    const buf = out[0];
    buf.fill(0);
    const twoPi = 2 * Math.PI;
    for (const v of this.voices) {
      for (let i = v.delay; i < n && v.age < v.length; i++, v.age++) {
        const tt = v.age / sampleRate;
        let x = 0;
        switch (v.timbre) {
          case 'beep': {
            const env = Math.min(1, tt / 0.001) * Math.exp(-tt / 0.018);
            v.phase += (twoPi * v.pitch) / sampleRate;
            x = Math.sin(v.phase) * env;
            break;
          }
          case 'wood': {
            // Two inharmonic partials with a quick pitch drop: a woodblock-ish knock.
            const env = Math.min(1, tt / 0.0005) * Math.exp(-tt / 0.009);
            const f = v.pitch * (1 + 0.15 * Math.exp(-tt / 0.003));
            v.phase += (twoPi * f) / sampleRate;
            v.phase2 += (twoPi * f * 2.76) / sampleRate;
            x = (Math.sin(v.phase) * 0.8 + Math.sin(v.phase2) * 0.35 * Math.exp(-tt / 0.004)) * env;
            break;
          }
          case 'click': {
            const env = Math.exp(-tt / 0.0025);
            const r = this.rand();
            // Brightness follows pitch: one-pole low-pass, then difference (high-pass).
            const k = Math.min(0.99, v.pitch / 4000);
            v.lp += (r - v.lp) * k;
            x = (v.lp - v.noise) * env * 2.5;
            v.noise = v.lp;
            break;
          }
          case 'bell': {
            const env = Math.min(1, tt / 0.001) * Math.exp(-tt / 0.07);
            v.phase += (twoPi * v.pitch) / sampleRate;
            v.phase2 += (twoPi * v.pitch * 2.4) / sampleRate;
            x = (Math.sin(v.phase) * 0.7 + Math.sin(v.phase2) * 0.3 * Math.exp(-tt / 0.03)) * env;
            break;
          }
        }
        buf[i] += x * v.gain * 0.6;
      }
      v.delay = 0;
    }
    this.voices = this.voices.filter((v) => v.age < v.length);
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      buf[i] = x > 1 ? 1 : x < -1 ? -1 : x; // hard clip as a safety net
    }
    for (let c = 1; c < out.length; c++) out[c].set(buf);
    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
