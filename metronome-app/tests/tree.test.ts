import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../src/lib/model/syntax';
import { duplicate, joinPrevious, move, remove, unwrap, wrapInRepeat } from '../src/lib/model/tree';

const p = (s: string) => parse(s).piece;

describe('tree editing', () => {
  it('moves items and steps out of repeats', () => {
    const piece = p('4/4, |: 3/4, 5/8 :|, 7/8');
    const rep = piece.items[1] as { items: { id: string }[] };
    move(piece.items, rep.items[0].id, -1);
    expect(serialize(piece)).toBe('4/4, 3/4\n|: 5/8 :|\n7/8');
  });

  it('joins a preceding repeat, unwraps, wraps, duplicates and removes', () => {
    const piece = p('|: 3/4 :|, 5/8');
    joinPrevious(piece.items, piece.items[1].id);
    expect(serialize(piece)).toBe('|: 3/4, 5/8 :|');
    unwrap(piece.items, piece.items[0].id);
    expect(serialize(piece)).toBe('3/4, 5/8');
    wrapInRepeat(piece.items, piece.items[1].id);
    expect(serialize(piece)).toBe('3/4\n|: 5/8 :|');
    const piece2 = p('A: 3/4 x2');
    duplicate(piece2.items, piece2.items[0].id);
    expect(serialize(piece2)).toBe('A: 3/4 x2, 3/4 x2');
    remove(piece2.items, piece2.items[0].id);
    expect(serialize(piece2)).toBe('3/4 x2');
  });
});
