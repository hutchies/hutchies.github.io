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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export interface TapEstimate {
  /** Mean asynchrony after dropping outliers, ms. */
  value: number;
  /** Half-width of its 95% confidence interval, ms. */
  error: number;
  /** Taps used (after dropping outliers). */
  count: number;
}

/**
 * Average asynchrony, ignoring the odd fumbled tap (more than 3 robust
 * standard deviations from the median), and how well it is pinned down.
 */
export function estimateTaps(xs: number[]): TapEstimate {
  if (xs.length < 2) return { value: xs[0] ?? NaN, error: Infinity, count: xs.length };
  const m = median(xs);
  // Scaled MAD estimates the standard deviation; floor it so a few
  // identical taps can't make everything else look like an outlier.
  const sigma = Math.max(5, 1.4826 * median(xs.map((x) => Math.abs(x - m))));
  const kept = xs.filter((x) => Math.abs(x - m) <= 3 * sigma);
  const n = kept.length;
  const mean = kept.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { value: mean, error: n >= 2 ? (1.96 * sd) / Math.sqrt(n) : Infinity, count: n };
}

/** Stop a round once the average is known to within this (95% interval), ms... */
export const TARGET_ERROR_MS = 10;
/** ...from at least this many taps. */
export const MIN_TAPS = 6;
/** A round that runs out of beats is still usable if within this, ms. */
export const ACCEPT_ERROR_MS = 20;

export function converged(e: TapEstimate): boolean {
  return e.count >= MIN_TAPS && e.error <= TARGET_ERROR_MS;
}

export function usable(e: TapEstimate): boolean {
  return e.count >= MIN_TAPS && e.error <= ACCEPT_ERROR_MS;
}

/**
 * The display delay, given the click round and the player's tapping bias
 * (the flash round, which can be reused: it depends on the player and the
 * device, not on the headphones). Rounded to 5 ms.
 */
export function latencyMs(audio: TapEstimate, bias: number): number {
  return Math.round((audio.value - bias) / 5) * 5;
}
