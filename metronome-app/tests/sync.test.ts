import { describe, expect, it } from 'vitest';
import { positionAt } from '../src/lib/audio/transport';
import { compile } from '../src/lib/model/compile';
import { parse } from '../src/lib/model/syntax';
import { ClockSync, estimateOffset, type ClockSample } from '../src/lib/sync/clock';
import {
  applyCue,
  initialPlayback,
  loopSpecFor,
  replay,
  resolveLoop,
  resolveSyncPoint,
  shiftState,
  syncPointAt,
  type Cue,
  type LocalContext,
} from '../src/lib/sync/cues';

const tl = (s: string) => compile(parse(s).piece);
const ctx = (s: string, countIn = { amount: 0, unit: 'bars' as const }): LocalContext => ({
  timeline: tl(s),
  countIn,
});

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('clock estimation', () => {
  it('recovers the offset despite asymmetric jitter', () => {
    const trueOffset = 1_700_000_000_000 - 1234.5;
    const r = rng(7);
    const samples: ClockSample[] = [];
    let local = 1000;
    for (let i = 0; i < 12; i++) {
      // 20 ms base each way, plus up to 80 ms of one-sided queueing delay.
      const up = 20 + (r() < 0.7 ? r() * 80 : r() * 2);
      const down = 20 + (r() < 0.7 ? r() * 80 : r() * 2);
      const t0 = local;
      const server = Math.round(t0 + up + trueOffset);
      const t1 = t0 + up + down;
      samples.push({ t0, t1, server });
      local = t1 + 5;
    }
    const est = estimateOffset(samples)!;
    expect(Math.abs(est.offset - trueOffset)).toBeLessThan(est.error);
    expect(est.error).toBeLessThan(35);
  });

  it('runs a burst through ClockSync', async () => {
    let local = 0;
    const sync = new ClockSync({
      now: () => local,
      fetchTime: async () => {
        local += 10;
        const server = local + 5000;
        local += 10;
        return server;
      },
      burst: 5,
    });
    const est = await sync.start();
    sync.stop();
    expect(est.offset).toBeCloseTo(5000);
    expect(sync.toServer(100)).toBeCloseTo(5100);
    expect(sync.toLocal(5100)).toBeCloseTo(100);
  });
});

describe('sync points', () => {
  const MAP = 'A: c=120 4/4 x4\nB: 3/4 x2\nC: 4/4 x4';

  it('round-trips positions within one map', () => {
    const t = tl(MAP);
    for (const bi of [0, 2, 4, 5, 9]) {
      const s = t.bars[bi].start;
      expect(resolveSyncPoint(t, syncPointAt(t, s))).toBeCloseTo(s);
    }
    const mid = (t.bars[5].start + t.bars[5].end) / 2;
    expect(resolveSyncPoint(t, syncPointAt(t, mid))).toBeCloseTo(mid);
  });

  it('finds the same mark in a different map', () => {
    const leader = tl(MAP);
    // A part with a longer intro and different bar lengths.
    const part = tl('c=120 4/4 x8\nB: 6/8 x2\nC: 2/4 x4');
    const sp = syncPointAt(leader, leader.bars[7].start); // C, bar 2
    expect(sp).toMatchObject({ mark: 'C', offset: 1 });
    expect(resolveSyncPoint(part, sp)).toBeCloseTo(part.bars[11].start);
  });

  it('falls back to bar numbers, then the top', () => {
    const leader = tl('c=120 4/4 x10');
    const part = tl('c=60 3/4 x12');
    expect(resolveSyncPoint(part, syncPointAt(leader, leader.bars[6].start))).toBeCloseTo(part.bars[6].start);
    expect(resolveSyncPoint(tl('4/4 x2'), { bar: 50 })).toBe(0);
    expect(resolveSyncPoint(part, { top: true })).toBe(0);
  });

  it('starts every map at its top when the leader starts at the top', () => {
    const leader = tl('@0 4/4, A: 4/4 x4');
    const part = tl('A: 4/4 x4');
    expect(syncPointAt(leader, 0)).toMatchObject({ top: true });
    expect(resolveSyncPoint(part, syncPointAt(leader, 0))).toBe(0);
  });

  it('distinguishes repeat passes', () => {
    const t = tl('|: A: c=120 4/4 x2 :|, B: 4/4');
    const sp = syncPointAt(t, t.bars[2].start); // A, second pass
    expect(sp).toMatchObject({ mark: 'A', markPass: 2, offset: 0 });
    expect(resolveSyncPoint(t, sp)).toBeCloseTo(t.bars[2].start);
  });

  it('maps loop regions between maps', () => {
    const leader = tl(MAP);
    const part = tl('c=60 4/4 x4\nB: 3/4 x2\nC: 4/4 x4');
    const spec = loopSpecFor(leader, { start: leader.bars[4].start, end: leader.bars[5].end });
    expect(resolveLoop(part, spec)).toEqual({ start: part.bars[4].start, end: part.bars[5].end });
    expect(loopSpecFor(leader, { start: 0, end: leader.duration })).toBe('all');
    expect(resolveLoop(part, 'all')).toEqual({ start: 0, end: part.duration });
  });
});

describe('cue reduction', () => {
  const start = (at: number, sync = {}, extra = {}): Cue => ({
    seq: 1,
    kind: 'start',
    at,
    payload: { sync, tempoPercent: 100, loop: null, ...extra },
  });

  it('lands different maps on the same downbeat, each with its own count-in', () => {
    const a = ctx('A: c=120 4/4 x4\nB: 3/4 x4', { amount: 1, unit: 'bars' });
    const b = ctx('c=90 7/8 x2\nA: c=120 4/4 x4\nB: 6/8 x4', { amount: 2, unit: 'bars' });
    const cue = start(100_000, { mark: 'B', offset: 0 });
    const pa = replay([cue], a);
    const pb = replay([cue], b);
    // Both reach their own bar B exactly at the cue's instant.
    expect(pa.state.anchorTime).toBe(100);
    expect(pb.state.anchorTime).toBe(100);
    expect(pa.state.anchorScore).toBeCloseTo(a.timeline.bars[4].start);
    expect(pb.state.anchorScore).toBeCloseTo(b.timeline.bars[6].start);
    // Count-ins end on the downbeat, in each map's metre: one bar of 3/4 at
    // c=120 vs two bars of 6/8 (12 quavers).
    expect(pa.countIn!.times[0]).toBeCloseTo(98.5);
    expect(pa.countIn!.times).toHaveLength(3);
    expect(pb.countIn!.times).toHaveLength(12);
    expect(pb.countIn!.startTime).toBe(100);
  });

  it('applies tempo, pause and stop at their instants', () => {
    const c = ctx('c=120 4/4 x8');
    const cues: Cue[] = [
      start(10_000),
      { seq: 2, kind: 'update', at: 12_000, payload: { tempoPercent: 50 } },
      { seq: 3, kind: 'pause', at: 14_000, payload: {} },
    ];
    const p = replay(cues, c);
    expect(p.mode).toBe('paused');
    expect(p.tempoPercent).toBe(50);
    // 2 s at full speed, then 2 s at half speed.
    expect(positionAt(p.state, 20).score).toBeCloseTo(3);
    const stopped = applyCue(p, { seq: 4, kind: 'stop', at: 15_000, payload: {} }, c);
    expect(positionAt(stopped.state, 16).score).toBe(0);
    expect(stopped.mode).toBe('stopped');
  });

  it('cancels the rest of a count-in on stop', () => {
    const c = ctx('c=60 4/4 x4', { amount: 1, unit: 'bars' });
    const p = replay([start(10_000), { seq: 2, kind: 'stop', at: 7_500, payload: {} }], c);
    expect(p.countIn!.times).toEqual([6, 7]);
  });

  it('releases tap pauses on the leader’s cue, including a map that reaches it a little later', () => {
    const lead = ctx('c=120 4/4 x2\nwait\n4/4 x2');
    // The same music, but this map's second bar is a hair longer.
    const part = ctx('c=120 4/4\nc=119 4/4\nwait\nc=120 4/4 x2');
    const cues: Cue[] = [start(0), { seq: 2, kind: 'release', at: 5_000, payload: {} }];
    const pl = replay(cues, lead);
    expect(positionAt(pl.state, 4.9).frozen?.kind).toBe('hold');
    expect(positionAt(pl.state, 5.5).score).toBeCloseTo(4.5);
    const hold = part.timeline.holds[0];
    expect(hold).toBeGreaterThan(4.01);
    // Held when the release arrives: continues at the cue.
    expect(replay(cues, part).state.anchorTime).toBeCloseTo(5);
    // Not held yet (the leader's map got there first): carries straight on when it does.
    const late = replay([start(0), { seq: 2, kind: 'release', at: 4_005, payload: {} }], part);
    expect(late.state.anchorTime).toBeCloseTo(hold);
    expect(positionAt(late.state, hold + 0.5).score).toBeCloseTo(hold + 0.5);
    // A release long before this map's pause is ignored.
    expect(replay([start(0), { seq: 2, kind: 'release', at: 1_000, payload: {} }], part).state.anchorTime).toBe(0);
  });

  it('lets a late joiner compute the current position', () => {
    const c = ctx('c=120 4/4 x100');
    const p = replay([start(1_000_000)], c);
    // 37.25 s later, wherever this device's clock domain is.
    const delta = -999_990; // server seconds -> this device's audio seconds
    const st = shiftState(p.state, delta);
    expect(positionAt(st, 1_000 + delta + 37.25).score).toBeCloseTo(37.25);
  });

  it('ignores a seek while playing and moves home while stopped', () => {
    const c = ctx('A: c=120 4/4 x4\nB: 4/4 x4');
    const seek: Cue = { seq: 2, kind: 'seek', at: 0, payload: { sync: { mark: 'B' } } };
    expect(replay([start(0), seek], c).home).toBe(0);
    const p = applyCue(initialPlayback(c.timeline), seek, c);
    expect(p.home).toBeCloseTo(8);
    expect(positionAt(p.state, 1).score).toBeCloseTo(8);
  });

  it('replays out-of-order deliveries by sequence number', () => {
    const c = ctx('c=120 4/4 x8');
    const a = replay([start(0), { seq: 2, kind: 'pause', at: 2_000, payload: {} }], c);
    const b = replay([{ seq: 2, kind: 'pause', at: 2_000, payload: {} }, start(0)], c);
    expect(b).toEqual(a);
  });
});
