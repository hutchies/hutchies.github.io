import { describe, expect, it } from 'vitest';
import { pieces, positionAt, STOPPED, withPrev, type TransportState } from '../src/lib/audio/transport';

const base: TransportState = { ...STOPPED, playing: true, anchorTime: 10, anchorScore: 0, end: 20 };

describe('transport', () => {
  it('advances linearly at rate', () => {
    const st = { ...base, rate: 0.5 };
    expect(positionAt(st, 14).score).toBe(2);
  });

  it('stops at the end', () => {
    const p = positionAt(base, 100);
    expect(p.score).toBe(20);
    expect(p.frozen).toEqual({ kind: 'end', at: 20 });
  });

  it('wraps loops, including far into the future', () => {
    const st = { ...base, loop: { start: 4, end: 8 } };
    expect(positionAt(st, 10 + 9).score).toBeCloseTo(5);
    expect(positionAt(st, 10 + 8 + 4 * 1000 + 1).score).toBeCloseTo(5);
  });

  it('holds at a tap and releases', () => {
    const st = { ...base, holds: [5] };
    expect(positionAt(st, 30)).toMatchObject({ score: 5, frozen: { kind: 'hold', at: 5 } });
    const released = withPrev({ ...st, anchorTime: 40, anchorScore: 5, releaseAtAnchor: true }, st);
    expect(positionAt(released, 39).score).toBe(5);
    expect(positionAt(released, 41).score).toBe(6);
  });

  it('re-arms holds on each loop pass', () => {
    const st = { ...base, holds: [6], loop: { start: 4, end: 8 }, anchorScore: 6, releaseAtAnchor: true };
    // 6 -> 8 (2 s), wrap to 4, then 2 s to reach 6 again and hold.
    expect(positionAt(st, 13).score).toBe(5);
    expect(positionAt(st, 20).frozen).toEqual({ kind: 'hold', at: 6 });
  });

  it('produces pieces across a state change', () => {
    const a = { ...base };
    const b = withPrev({ ...base, anchorTime: 12, anchorScore: 2, rate: 2 }, a);
    const ps = pieces(b, 11, 13);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ t0: 10, t1: 12, s0: 0, rate: 1 });
    expect(ps[1]).toMatchObject({ t0: 12, s0: 2, rate: 2 });
  });

  it('is pending before the anchor', () => {
    const paused = { ...base, playing: false, anchorScore: 3 };
    const st = withPrev({ ...base, anchorScore: 3, anchorTime: 50 }, paused);
    expect(positionAt(st, 45)).toMatchObject({ score: 3, pending: true });
    expect(positionAt(st, 51)).toMatchObject({ score: 4, pending: false });
  });
});
