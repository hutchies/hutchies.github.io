/**
 * Measuring how late this device's audio really is, by tapping along.
 *
 * Tapping to a click measures audio latency, but it also includes the
 * input's own lag (touchscreens can add 30–80 ms) and the player's habit of
 * tapping slightly early or late. Tapping to a silent flash measures the
 * same input lag and habit, plus the screen's lag. The difference between the
 * two is how far the sound trails the picture: exactly the "display delay"
 * that lines up the display with the clicks (and, in a group, starts this
 * device's clicks earlier to match everyone else's).
 */

/**
 * Tap minus target (ms). Each tap is matched to the target it follows by
 * `lo`..`hi` ms. The window is lopsided because latency only ever delays a
 * tap (Bluetooth can add 300 ms, more than half a beat at 120 bpm), while
 * people anticipate a beat by a few tens of ms at most. Make the window no
 * wider than the gap between targets.
 */
export function asynchronies(taps: number[], targets: number[], lo = -150, hi = 350): number[] {
  const out: number[] = [];
  for (const tap of taps) {
    const t = targets.find((x) => tap - x >= lo && tap - x < hi);
    if (t !== undefined) out.push(tap - t);
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface TapStats {
  /** Median asynchrony, ms. */
  median: number;
  /** Interquartile range, ms: how steady the tapping was. */
  spread: number;
  count: number;
}

export function tapStats(xs: number[]): TapStats {
  const s = [...xs].sort((a, b) => a - b);
  return { median: quantile(s, 0.5), spread: quantile(s, 0.75) - quantile(s, 0.25), count: s.length };
}

export interface LatencyResult {
  /** Suggested display delay, ms (rounded to 5). */
  offsetMs: number;
  /** Enough steady taps in both rounds to trust the result. */
  reliable: boolean;
  audio: TapStats;
  visual: TapStats;
}

export const MIN_TAPS = 6;
export const MAX_SPREAD_MS = 70;

export function latencyFromTaps(audio: number[], visual: number[]): LatencyResult {
  const a = tapStats(audio);
  const v = tapStats(visual);
  const raw = a.median - v.median;
  return {
    offsetMs: Number.isFinite(raw) ? Math.round(raw / 5) * 5 : 0,
    reliable: a.count >= MIN_TAPS && v.count >= MIN_TAPS && a.spread <= MAX_SPREAD_MS && v.spread <= MAX_SPREAD_MS,
    audio: a,
    visual: v,
  };
}
