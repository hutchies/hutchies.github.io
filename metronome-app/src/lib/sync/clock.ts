/**
 * NTP-style clock synchronisation against the server's clock.
 *
 * Each sample is one request: local send time t0, the server's reading, and
 * local receive time t1 (all ms). Assuming the request and response took
 * equally long, the server read its clock at local time (t0 + t1) / 2. The
 * fastest round trips have the least room for asymmetry, so the estimate uses
 * only the best few recent samples.
 */

export interface ClockSample {
  /** Local send time (performance.now(), ms). */
  t0: number;
  /** Local receive time (ms). */
  t1: number;
  /** Server clock reading (ms since epoch). */
  server: number;
}

export interface ClockEstimate {
  /** Add to performance.now() to get server time, ms. */
  offset: number;
  /** Worst-case error of the offset, ms (half the best round trip). */
  error: number;
  /** Best recent round-trip time, ms. */
  rtt: number;
}

/** Number of lowest-RTT samples the estimate is taken from. */
const BEST = 4;

export function estimateOffset(samples: ClockSample[]): ClockEstimate | null {
  const valid = samples.filter((s) => s.t1 >= s.t0 && Number.isFinite(s.server));
  if (!valid.length) return null;
  const best = [...valid].sort((a, b) => a.t1 - a.t0 - (b.t1 - b.t0)).slice(0, BEST);
  const offsets = best.map((s) => s.server - (s.t0 + s.t1) / 2).sort((a, b) => a - b);
  const rtt = best[0].t1 - best[0].t0;
  return {
    offset: median(offsets),
    // The server's clock has 1 ms resolution, hence the extra 0.5 ms.
    error: rtt / 2 + 0.5,
    rtt,
  };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export interface ClockSyncOptions {
  /** Returns the server's clock in ms. */
  fetchTime: () => Promise<number>;
  now?: () => number;
  /** Requests in the initial burst. */
  burst?: number;
  /** Requests in each later top-up. */
  topUp?: number;
  /** Interval between top-ups, ms. */
  interval?: number;
  /** Samples older than this are discarded (bounds clock drift), ms. */
  window?: number;
}

/**
 * Keeps a running estimate of the server clock: a burst of requests on start,
 * then a few more every `interval` to follow drift between the two clocks.
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly now: () => number;
  estimate: ClockEstimate | null = null;
  onUpdate: (e: ClockEstimate) => void = () => {};

  constructor(private opts: ClockSyncOptions) {
    this.now = opts.now ?? (() => performance.now());
  }

  /** Runs the initial burst; resolves once there is an estimate. */
  async start(): Promise<ClockEstimate> {
    this.stopped = false;
    await this.sample(this.opts.burst ?? 12);
    if (!this.estimate) throw new Error('Could not reach the sync server.');
    this.schedule();
    return this.estimate;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Server time (ms) corresponding to a local performance.now() time. */
  toServer(local: number): number {
    return local + (this.estimate?.offset ?? 0);
  }

  toLocal(server: number): number {
    return server - (this.estimate?.offset ?? 0);
  }

  serverNow(): number {
    return this.toServer(this.now());
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      await this.sample(this.opts.topUp ?? 4).catch(() => {});
      this.schedule();
    }, this.opts.interval ?? 15_000);
  }

  private async sample(n: number) {
    for (let i = 0; i < n && !this.stopped; i++) {
      const t0 = this.now();
      let server: number;
      try {
        server = await this.opts.fetchTime();
      } catch {
        continue;
      }
      const t1 = this.now();
      this.samples.push({ t0, t1, server });
    }
    const cutoff = this.now() - (this.opts.window ?? 2 * 60_000);
    this.samples = this.samples.filter((s) => s.t1 >= cutoff);
    const est = estimateOffset(this.samples);
    if (est) {
      this.estimate = est;
      this.onUpdate(est);
    }
  }
}
