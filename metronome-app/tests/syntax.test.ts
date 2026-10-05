import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../src/lib/model/syntax';
import type { BlockItem, RepeatItem } from '../src/lib/model/types';

const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' ? undefined : v)));

describe('parse', () => {
  it('parses the original v1 syntax', () => {
    const { piece, errors } = parse('A: c=120 4/4 x3, 3/4\nB: q=200 7/8 x2');
    expect(errors).toEqual([]);
    expect(strip(piece.items)).toEqual([
      { kind: 'bars', bars: 3, mark: 'A', metre: { num: 4, denom: 4 }, tempo: { unit: { base: 4, dots: 0 }, bpm: 120 } },
      { kind: 'bars', bars: 1, metre: { num: 3, denom: 4 } },
      { kind: 'bars', bars: 2, mark: 'B', metre: { num: 7, denom: 8 }, tempo: { unit: { base: 8, dots: 0 }, bpm: 200 } },
    ]);
  });

  it('parses additive metres, dotted tempi, glides, bar numbers and pauses', () => {
    const { piece, errors } = parse('# My Piece\n@0 1/4, q.=60 3+3+2/8 x4 rit q.=50\nwait\nwait 2.5s\n4=90 accel 2=60 x2');
    expect(errors).toEqual([]);
    expect(piece.title).toBe('My Piece');
    const [a, b, w, gp, c] = piece.items as BlockItem[];
    expect(a.barNumber).toBe(0);
    expect(b.metre).toEqual({ num: 8, denom: 8, groups: [3, 3, 2] });
    expect(b.tempo).toEqual({ unit: { base: 8, dots: 1 }, bpm: 60 });
    expect(b.tempoTo).toEqual({ unit: { base: 8, dots: 1 }, bpm: 50 });
    expect(w).toMatchObject({ kind: 'pause' });
    expect((w as unknown as { seconds?: number }).seconds).toBeUndefined();
    expect(gp).toMatchObject({ kind: 'pause', seconds: 2.5 });
    expect(c.tempoTo).toEqual({ unit: { base: 2, dots: 0 }, bpm: 60 });
  });

  it('parses repeats, including nested and inline signs', () => {
    const { piece, errors } = parse('4/4 x2\n|: A: x4, |: 3/4 :| x3 :|\n5/8');
    expect(errors).toEqual([]);
    expect(piece.items).toHaveLength(3);
    const rep = piece.items[1] as RepeatItem;
    expect(rep.kind).toBe('repeat');
    expect(rep.times).toBe(2);
    expect((rep.items[1] as RepeatItem).times).toBe(3);
  });

  it('treats an unmatched end-repeat as repeating from the start', () => {
    const { piece } = parse('4/4 x4 :|, 3/4');
    expect(piece.items[0].kind).toBe('repeat');
    expect(piece.items[1].kind).toBe('bars');
  });

  it('reports errors with line numbers', () => {
    const { errors } = parse('4/4 x2\nfoo 3/4\n|: x2');
    expect(errors).toEqual([
      { line: 2, message: 'Unrecognised "foo"' },
      { line: 3, message: 'Repeat start |: has no matching :|' },
    ]);
  });

  it('ignores comments', () => {
    const { piece, errors } = parse('# Title\n// a comment\n4/4 x2 // trailing\n# another');
    expect(errors).toEqual([]);
    expect(piece.items).toHaveLength(1);
  });
});

describe('serialize', () => {
  it('round-trips', () => {
    const src = '# Test\nA: c=120 4/4 x8, 3/4\n|: B: q.=80 3+2+2/8 x4, x2 rit q.=60 :| x3\nwait\nwait 2s\nC: @20 m=60 x2';
    const once = serialize(parse(src).piece);
    expect(strip(parse(once).piece)).toEqual(strip(parse(src).piece));
    expect(serialize(parse(once).piece)).toBe(once);
  });

  it('writes accel/rit by direction', () => {
    expect(serialize(parse('c=100 x4 ~c=140').piece)).toBe('c=100 x4 accel c=140');
    expect(serialize(parse('c=100 x4 ~c=80').piece)).toBe('c=100 x4 rit c=80');
  });
});

describe('serialize layout', () => {
  it('keeps a repeat sign on the same line as a marked entry', () => {
    expect(serialize(parse('A: 4/4, |: B: 3/4 x2 :|, wait').piece)).toBe('A: 4/4\n|: B: 3/4 x2 :|\nwait');
  });
});
