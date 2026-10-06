/**
 * Compiles a Piece into a flat Timeline: every click, bar and pause placed in
 * "score time" (seconds at 100% tempo). The audio engine and the display both
 * work purely from this timeline, which is what keeps them in lock-step.
 */
import { effectiveGroups, metreEquals, tempoEquals, wholesPerSecond } from './music';
import {
  DEFAULT_METRE,
  DEFAULT_TEMPO,
  type BlockItem,
  type Item,
  type Metre,
  type Piece,
  type Tempo,
} from './types';

/** Click accent levels. */
export const LEVEL_BAR = 0;
export const LEVEL_BEAT = 1;
export const LEVEL_PULSE = 2;
export const LEVEL_SUB = 3;
/** Count-in clicks use their own levels so they can sound different. */
export const LEVEL_COUNT_BAR = 4;
export const LEVEL_COUNT_BEAT = 5;

export interface BarInfo {
  index: number;
  /** Written bar number (repeats reuse numbers). */
  number: number;
  start: number;
  end: number;
  metre: Metre;
  groups: number[];
  /** Start time of each pulse in the bar. */
  pulses: number[];
  tempoStart: Tempo;
  tempoEnd: Tempo;
  glide: boolean;
  /** First bar of a glide block, for drawing "rit."/"accel." */
  glideStart: boolean;
  /** Last bar of a glide block. */
  glideEnd: boolean;
  mark?: string;
  metreChanged: boolean;
  tempoChanged: boolean;
  itemId: string;
  /** Repeat pass info for the innermost repeat containing this bar. */
  pass?: { n: number; of: number };
  /** True for the first bar of a repeat pass. */
  repeatStart: boolean;
  /** True for the last bar of a repeat pass. */
  repeatEnd: boolean;
}

export interface PauseInfo {
  time: number;
  /** Duration in score seconds; 0 for tap-to-continue. */
  seconds: number;
  tap: boolean;
  mark?: string;
  itemId: string;
}

export interface MarkInfo {
  label: string;
  time: number;
  barIndex: number;
  pass?: number;
}

export interface Timeline {
  clickTimes: Float64Array;
  clickLevels: Uint8Array;
  bars: BarInfo[];
  pauses: PauseInfo[];
  /** Score times at which playback waits for a tap. Sorted. */
  holds: number[];
  marks: MarkInfo[];
  duration: number;
  /**
   * True if the piece ends with an indefinite block. Its bars are laid out
   * up to a long horizon, so `duration` is where playback finally gives up.
   */
  open: boolean;
  /** Start of the indefinite block (equals `duration` when not open). */
  openStart: number;
}

/** How far an indefinite block is laid out, in score seconds. */
export const FOREVER_SECONDS = 4 * 60 * 60;
/** Upper bound on bars laid out for an indefinite block. */
const FOREVER_MAX_BARS = 50000;

export interface CompileOptions {
  /** Extra clicks per pulse: 1 = none, 2 = halves, 3 = triplets, 4 = quarters. */
  subdivide?: number;
}

export function compile(piece: Piece, opts: CompileOptions = {}): Timeline {
  const sub = Math.max(1, Math.floor(opts.subdivide ?? 1));
  const times: number[] = [];
  const levels: number[] = [];
  const bars: BarInfo[] = [];
  const pauses: PauseInfo[] = [];
  const holds: number[] = [];
  const marks: MarkInfo[] = [];

  let now = 0;
  let metre: Metre = DEFAULT_METRE;
  let tempo: Tempo = DEFAULT_TEMPO;
  let barNumber = 1;
  let prevMetre: Metre | undefined;
  let prevTempo: Tempo | undefined;
  let open = false;
  let openStart = 0;

  const pushClick = (t: number, level: number) => {
    times.push(t);
    levels.push(level);
  };

  const block = (b: BlockItem, pass?: { n: number; of: number }, firstOfPass = false) => {
    if (b.metre) metre = b.metre;
    if (b.tempo) tempo = b.tempo;
    if (b.barNumber !== undefined) barNumber = b.barNumber;
    const groups = effectiveGroups(metre);
    const w0 = wholesPerSecond(tempo);
    // An indefinite block holds its tempo (no glide) and is laid out to the horizon.
    const target = b.forever ? undefined : b.tempoTo;
    const w1 = target ? wholesPerSecond(target) : w0;
    const barLen = metre.num / metre.denom; // in whole notes
    const count = b.forever
      ? Math.max(1, Math.min(FOREVER_MAX_BARS, Math.ceil((FOREVER_SECONDS * w0) / barLen)))
      : Math.max(1, b.bars);
    if (b.forever) {
      open = true;
      openStart = now;
    }
    const total = barLen * count;
    const pulseLen = 1 / metre.denom;

    // Time (from block start) to reach position x whole notes into the block.
    const timeAt = (x: number) => {
      if (Math.abs(w1 - w0) < 1e-9) return x / w0;
      const k = (w1 - w0) / total;
      return Math.log((w0 + k * x) / w0) / k;
    };
    const tempoAt = (x: number): Tempo => {
      const w = w0 + ((w1 - w0) * x) / total;
      return { unit: tempo.unit, bpm: (tempo.bpm * w) / w0 };
    };

    const blockStart = now;
    for (let i = 0; i < count; i++) {
      const x0 = i * barLen;
      const start = blockStart + timeAt(x0);
      const end = blockStart + timeAt(x0 + barLen);
      const pulses: number[] = [];
      let p = 0;
      groups.forEach((g) => {
        for (let j = 0; j < g; j++, p++) {
          const xs = x0 + p * pulseLen;
          const t = blockStart + timeAt(xs);
          pulses.push(t);
          const level = p === 0 ? LEVEL_BAR : j === 0 ? LEVEL_BEAT : LEVEL_PULSE;
          pushClick(t, level);
          if (sub > 1) {
            for (let s = 1; s < sub; s++) {
              pushClick(blockStart + timeAt(xs + (pulseLen * s) / sub), LEVEL_SUB);
            }
          }
        }
      });
      const tStart = tempoAt(x0);
      const tEnd = tempoAt(x0 + barLen);
      const bar: BarInfo = {
        index: bars.length,
        number: barNumber,
        start,
        end,
        metre,
        groups,
        pulses,
        tempoStart: i === 0 ? tempo : tStart,
        tempoEnd: i === count - 1 && target ? target : tEnd,
        glide: !!target,
        glideStart: !!target && i === 0,
        glideEnd: !!target && i === count - 1,
        metreChanged: !prevMetre || !metreEquals(prevMetre, metre),
        tempoChanged: i === 0 && (!prevTempo || !tempoEquals(prevTempo, tempo)),
        itemId: b.id,
        pass,
        repeatStart: firstOfPass && i === 0,
        repeatEnd: false,
      };
      if (i === 0 && b.mark !== undefined) {
        bar.mark = b.mark;
        marks.push({ label: b.mark, time: start, barIndex: bar.index, pass: pass?.n });
      }
      bars.push(bar);
      prevMetre = metre;
      prevTempo = bar.tempoEnd;
      barNumber++;
    }
    now = blockStart + timeAt(total);
    if (target) tempo = target;
  };

  const walk = (items: Item[], pass?: { n: number; of: number }) => {
    let first = true;
    for (const it of items) {
      // Nothing plays after an indefinite block.
      if (open) return;
      if (it.kind === 'bars') {
        block(it, pass, first);
      } else if (it.kind === 'pause') {
        const tap = it.seconds === undefined;
        pauses.push({ time: now, seconds: it.seconds ?? 0, tap, mark: it.mark, itemId: it.id });
        if (it.mark !== undefined) {
          marks.push({ label: it.mark, time: now, barIndex: bars.length, pass: pass?.n });
        }
        if (tap) holds.push(now);
        else now += Math.max(0, it.seconds!);
      } else {
        const startNumber = barNumber;
        let endNumber = barNumber;
        for (let n = 1; n <= it.times && !open; n++) {
          barNumber = startNumber;
          const before = bars.length;
          walk(it.items, { n, of: it.times });
          if (n === 1) endNumber = barNumber;
          if (bars.length > before) {
            bars[before].repeatStart = true;
            bars[bars.length - 1].repeatEnd = true;
          }
        }
        barNumber = endNumber;
      }
      first = false;
    }
  };

  walk(piece.items);

  return {
    clickTimes: Float64Array.from(times),
    clickLevels: Uint8Array.from(levels),
    bars,
    pauses,
    holds: [...new Set(holds)].sort((a, b) => a - b),
    marks,
    duration: now,
    open,
    openStart: open ? openStart : now,
  };
}

/** Index of the bar containing score time t (clamped). Binary search. */
export function barAt(tl: Timeline, t: number): number {
  const bars = tl.bars;
  if (!bars.length) return -1;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].start <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** First index i with arr[i] >= t. */
export function lowerBound(arr: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Count-in clicks for starting at a given bar: `beats` pulses-worth (or whole
 * bars) in the bar's metre and starting tempo. Returns offsets in score
 * seconds relative to the start (all negative) and levels.
 */
export function countIn(
  tl: Timeline,
  barIndex: number,
  spec: CountInSpec,
): { offsets: number[]; levels: number[]; duration: number } {
  const bar = tl.bars[Math.max(0, Math.min(barIndex, tl.bars.length - 1))];
  if (!bar || spec.amount <= 0) return { offsets: [], levels: [], duration: 0 };
  const m = bar.metre;
  const pulse = 1 / m.denom / wholesPerSecond(bar.tempoStart);
  const groups = bar.groups;
  // Build pulse accent pattern for one bar, then lay out count-in pulses
  // backwards from the start so they line up with the bar's grid.
  const pattern: number[] = [];
  groups.forEach((g) => {
    for (let j = 0; j < g; j++) pattern.push(pattern.length === 0 ? 0 : j === 0 ? 1 : 2);
  });
  let total: number;
  let onlyBeats = false;
  if (spec.unit === 'bars') {
    total = Math.round(spec.amount * m.num);
  } else {
    // Beats: count group starts (so 6/8 counts "1 2", 4/4 counts "1 2 3 4").
    onlyBeats = groups.some((g) => g > 1);
    let need = Math.round(spec.amount);
    total = 0;
    let gi = groups.length - 1;
    while (need > 0) {
      total += groups[gi];
      need--;
      gi = (gi - 1 + groups.length) % groups.length;
    }
  }
  const offsets: number[] = [];
  const levels: number[] = [];
  for (let k = total; k >= 1; k--) {
    const posInBar = (((m.num - k) % m.num) + m.num) % m.num;
    const lvl = pattern[posInBar];
    if (onlyBeats && lvl === 2) continue;
    offsets.push(-k * pulse);
    levels.push(lvl === 0 ? LEVEL_COUNT_BAR : LEVEL_COUNT_BEAT);
  }
  return { offsets, levels, duration: total * pulse };
}

export interface CountInSpec {
  amount: number;
  unit: 'bars' | 'beats';
}
