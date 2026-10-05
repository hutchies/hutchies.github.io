import { describe, expect, it } from 'vitest';
import { barAt, compile, countIn, LEVEL_BAR, LEVEL_BEAT, LEVEL_PULSE } from '../src/lib/model/compile';
import { parse } from '../src/lib/model/syntax';

const tl = (s: string, sub = 1) => compile(parse(s).piece, { subdivide: sub });

describe('compile', () => {
  it('places clicks for simple metres', () => {
    const t = tl('c=120 4/4 x2');
    expect(Array.from(t.clickTimes)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(Array.from(t.clickLevels.slice(0, 4))).toEqual([LEVEL_BAR, LEVEL_BEAT, LEVEL_BEAT, LEVEL_BEAT]);
    expect(t.duration).toBe(4);
    expect(t.bars.map((b) => b.number)).toEqual([1, 2]);
  });

  it('groups compound and additive metres', () => {
    expect(Array.from(tl('6/8').clickLevels)).toEqual([0, 2, 2, 1, 2, 2]);
    expect(Array.from(tl('2+3/8').clickLevels)).toEqual([0, 2, 1, 2, 2]);
    expect(Array.from(tl('5/8').clickLevels)).toEqual([0, 1, 1, 1, 1]);
  });

  it('respects tempo units', () => {
    // c.=60 in 6/8: one dotted crotchet per second, so a bar is 2 s.
    expect(tl('c.=60 6/8').duration).toBeCloseTo(2);
    expect(tl('m=60 4/4').duration).toBeCloseTo(2);
  });

  it('subdivides', () => {
    const t = tl('c=60 2/4', 2);
    expect(Array.from(t.clickTimes)).toEqual([0, 0.5, 1, 1.5]);
    expect(Array.from(t.clickLevels)).toEqual([LEVEL_BAR, 3, LEVEL_BEAT, 3]);
  });

  it('glides tempo smoothly and integrates time correctly', () => {
    const t = tl('c=60 4/4 x4 rit c=30');
    const times = Array.from(t.clickTimes);
    // Gaps grow monotonically.
    for (let i = 2; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThan(times[i - 1] - times[i - 2]);
    }
    // Linear tempo in beats from w0 to w1 over L: T = L/(w1-w0) * ln(w1/w0)
    const L = 4; // whole notes
    const w0 = 0.25, w1 = 0.125; // wholes per second
    expect(t.duration).toBeCloseTo((L / (w1 - w0)) * Math.log(w1 / w0), 9);
    // Next block inherits the target tempo.
    const t2 = tl('c=60 4/4 x4 rit c=30, x1');
    expect(t2.bars[4].end - t2.bars[4].start).toBeCloseTo(8);
  });

  it('unrolls repeats reusing bar numbers', () => {
    const t = tl('4/4 x2, |: A: x2 :| x3, 3/4');
    expect(t.bars.map((b) => b.number)).toEqual([1, 2, 3, 4, 3, 4, 3, 4, 5]);
    expect(t.bars[2].pass).toEqual({ n: 1, of: 3 });
    expect(t.bars[6].pass).toEqual({ n: 3, of: 3 });
    expect(t.marks.map((m) => m.pass)).toEqual([1, 2, 3]);
    expect(t.bars[3].repeatEnd).toBe(true);
  });

  it('handles pauses', () => {
    const t = tl('c=60 4/4, wait, x1, wait 3s, x1');
    expect(t.holds).toEqual([4]);
    expect(t.bars[1].start).toBe(4);
    expect(t.bars[2].start).toBe(11);
    expect(t.duration).toBe(15);
  });

  it('renumbers bars', () => {
    expect(tl('@0 1/4, 4/4 x2').bars.map((b) => b.number)).toEqual([0, 1, 2]);
  });

  it('finds bars by time', () => {
    const t = tl('c=60 4/4 x3');
    expect(barAt(t, 0)).toBe(0);
    expect(barAt(t, 4)).toBe(1);
    expect(barAt(t, 11.9)).toBe(2);
    expect(barAt(t, 100)).toBe(2);
  });

  it('builds count-ins', () => {
    const t = tl('c=60 4/4, q=120 6/8');
    expect(countIn(t, 0, { amount: 1, unit: 'bars' }).offsets).toEqual([-4, -3, -2, -1]);
    expect(countIn(t, 0, { amount: 2, unit: 'beats' }).offsets).toEqual([-2, -1]);
    const c68 = countIn(t, 1, { amount: 2, unit: 'beats' });
    expect(c68.offsets).toEqual([-3, -1.5]);
    expect(c68.levels).toEqual([4, 5]);
    expect(countIn(t, 0, { amount: 0, unit: 'bars' }).duration).toBe(0);
  });
});
