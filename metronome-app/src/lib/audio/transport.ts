/**
 * Transport: a pure, deterministic mapping from AudioContext time to score
 * time. The audio worklet uses it to decide which clicks fall in each render
 * quantum, and the canvas uses it to decide where to draw the playhead. Both
 * sides hold an identical copy of the state, and every change takes effect at
 * an agreed future `anchorTime`, so audio and display never drift apart.
 *
 * Between changes the score advances linearly at `rate`, except that it
 * stops at a tap-hold (until a new state releases it), wraps at the end of a
 * loop region, and stops at the end of the piece.
 */

export interface LoopRegion {
  start: number;
  end: number;
}

export interface TransportState {
  playing: boolean;
  /** AudioContext time at which this state takes effect. */
  anchorTime: number;
  /** Score time at anchorTime. */
  anchorScore: number;
  /** Score seconds per audio second (tempo percentage / 100). */
  rate: number;
  /** When resuming from a hold, ignore the hold exactly at anchorScore. */
  releaseAtAnchor: boolean;
  loop: LoopRegion | null;
  /** End of the piece in score time. */
  end: number;
  /** Sorted score times of tap-holds. */
  holds: number[];
  /** State in force before anchorTime (one level only). */
  prev?: TransportState;
}

export const STOPPED: TransportState = {
  playing: false,
  anchorTime: 0,
  anchorScore: 0,
  rate: 1,
  releaseAtAnchor: false,
  loop: null,
  end: 0,
  holds: [],
};

/** A stretch of audio time during which score time moves linearly. */
export interface Piece {
  t0: number;
  t1: number;
  s0: number;
  rate: number;
}

export type Frozen = null | { kind: 'hold' | 'end'; at: number };

function firstHold(holds: number[], s: number, skip: number): number {
  for (const h of holds) {
    if (h > s || (h === s && h !== skip)) return h;
  }
  return Infinity;
}

/**
 * Walk the state's linear pieces from anchorTime, calling `visit` for each
 * piece overlapping [tA, tB). Returns the frozen condition reached (if any)
 * and the score time it froze at.
 */
function walk(
  st: TransportState,
  tA: number,
  tB: number,
  visit: (p: Piece) => void,
): { frozen: Frozen } {
  if (!st.playing) return { frozen: null };
  const rate = Math.max(1e-6, st.rate);
  let s = st.anchorScore;
  let t = st.anchorTime;
  let skip = st.releaseAtAnchor ? st.anchorScore : NaN;
  const loop = st.loop && st.loop.end - st.loop.start > 1e-6 ? st.loop : null;

  for (let guard = 0; guard < 100000; guard++) {
    const inLoop = loop && s < loop.end - 1e-9;
    const bound = inLoop ? loop!.end : st.end;
    const hold = firstHold(st.holds, s, skip);
    const barrier = Math.min(hold, bound);
    const tb = t + Math.max(0, barrier - s) / rate;
    if (tb > tA && t < tB) {
      visit({ t0: t, t1: tb, s0: s, rate });
    }
    if (hold <= bound) return { frozen: { kind: 'hold', at: hold } };
    if (!inLoop) return { frozen: { kind: 'end', at: st.end } };
    // Wrap to loop start.
    t = tb;
    s = loop!.start;
    skip = NaN;
    if (t >= tB) return { frozen: null };
    // Skip whole passes when the loop contains no holds.
    if (firstHold(st.holds, s - 1e-9, NaN) >= loop!.end) {
      const pass = (loop!.end - loop!.start) / rate;
      const k = Math.floor((tA - t) / pass);
      if (k > 0) t += k * pass;
    }
  }
  return { frozen: null };
}

/** Linear pieces covering [tA, tB), honouring the previous state before anchorTime. */
export function pieces(st: TransportState, tA: number, tB: number): Piece[] {
  const out: Piece[] = [];
  if (st.prev && tA < st.anchorTime) {
    walk(st.prev, tA, Math.min(tB, st.anchorTime), (p) =>
      out.push({ ...p, t1: Math.min(p.t1, st.anchorTime) }),
    );
  }
  if (tB > st.anchorTime) walk(st, Math.max(tA, st.anchorTime), tB, (p) => out.push(p));
  return out;
}

export interface Position {
  score: number;
  frozen: Frozen;
  /** True while waiting for this state's anchorTime (e.g. during a count-in). */
  pending: boolean;
}

export function positionAt(st: TransportState, t: number): Position {
  if (st.prev && t < st.anchorTime) {
    return { ...positionAt(st.prev, t), pending: true };
  }
  if (!st.playing) return { score: st.anchorScore, frozen: null, pending: false };
  if (t < st.anchorTime) return { score: st.anchorScore, frozen: null, pending: true };
  let found: number | null = null;
  const res = walk(st, t, t + 1e-9, (p) => {
    if (t >= p.t0 && t < p.t1) found = p.s0 + (t - p.t0) * p.rate;
  });
  if (found !== null) return { score: found, frozen: null, pending: false };
  if (res.frozen) return { score: res.frozen.at, frozen: res.frozen, pending: false };
  return { score: st.anchorScore, frozen: null, pending: false };
}

/** Copy a state for sending to the worklet (drops nested prev). */
export function withPrev(next: TransportState, prev: TransportState): TransportState {
  const { prev: _drop, ...flatPrev } = prev;
  void _drop;
  return { ...next, prev: flatPrev };
}
