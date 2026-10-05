import { describe, expect, it } from 'vitest';
import { decodeLocation, encodePiece, escapeText, legacyToPiece, unescapeText } from '../src/lib/model/share';
import { parse, serialize } from '../src/lib/model/syntax';

describe('share', () => {
  it('escapes readably and round-trips', () => {
    const text = '# My_Piece #1\nA: c=120 4/4 x8\n|: B: 3+2/8 x4 :| x3; ok?';
    const esc = escapeText(text);
    expect(esc).toContain('A:_c=120_4/4_x8');
    expect(esc).toContain('3+2/8');
    expect(unescapeText(esc)).toBe(text);
  });

  it('encodes and decodes pieces both ways', async () => {
    const short = parse('A: c=120 4/4 x8').piece;
    const enc = await encodePiece(short);
    expect(enc.startsWith('m=')).toBe(true);
    expect(await decodeLocation({ hash: '#' + enc, search: '' })).toBe(serialize(short));

    const long = parse(Array.from({ length: 60 }, (_, i) => `M${i}: c=${100 + i} 7/8 x4`).join('\n')).piece;
    const encL = await encodePiece(long);
    expect(encL.startsWith('z=')).toBe(true);
    expect(await decodeLocation({ hash: '#' + encL, search: '' })).toBe(serialize(long));
  });

  it('decodes legacy v1 JSON', () => {
    const p = legacyToPiece([
      { metre: '4/4', bars: '10', rehearsal: 'A', tempo: { unit: { s: 1, n: 4, d: 1 }, bpm: '120' } },
      { metre: '7/8', bars: 2 },
    ]);
    expect(serialize(p)).toBe('A: c=120 4/4 x10, 7/8 x2');
  });
});
