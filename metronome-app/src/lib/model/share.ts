/**
 * Sharing pieces purely through the URL fragment.
 *
 * Two encodings, whichever is shorter is used:
 *   #m=<text>  the text syntax itself, lightly escaped so it stays readable
 *              (spaces become "_", line breaks ";"), e.g. #m=A:_c=120_4/4_x8;B:_3+2/8_x4
 *   #z=<b64>   deflate-raw compressed text, base64url (for long pieces)
 *
 * The fragment never reaches a server, so there is no length limit imposed by
 * hosting, and links work on any static host.
 *
 * Old links (?sequence=<pako deflateRaw JSON>) from the original app are decoded too.
 */
import { parse, serialize } from './syntax';
import { newId, type BlockItem, type Piece } from './types';

// Characters left as-is: RFC 3986 fragment characters plus "|", which browsers also leave alone in fragments.
const SAFE = /[A-Za-z0-9\-.~!$&'()*+,=:@/?|]/;

export function escapeText(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n/g, '\n')) {
    if (ch === ' ') out += '_';
    else if (ch === '\n') out += ';';
    else if (ch === '_') out += '%5F';
    else if (SAFE.test(ch)) out += ch;
    else out += encodeURIComponent(ch).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }
  return out;
}

export function unescapeText(s: string): string {
  return decodeURIComponent(s.replace(/_/g, ' ').replace(/;/g, '\n'));
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodePiece(piece: Piece): Promise<string> {
  const text = serialize(piece);
  const plain = 'm=' + escapeText(text);
  if (plain.length < 200 || typeof CompressionStream === 'undefined') return plain;
  const z = 'z=' + toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
  return z.length < plain.length * 0.8 ? z : plain;
}

export async function shareUrl(piece: Piece, base = location.href): Promise<string> {
  const u = new URL(base);
  u.search = '';
  u.hash = await encodePiece(piece);
  return u.toString();
}

/** Decode a piece from a location (hash or legacy query). Returns null if none. */
export async function decodeLocation(loc: { hash: string; search: string }): Promise<string | null> {
  const hash = loc.hash.replace(/^#/, '');
  if (hash.startsWith('m=')) return unescapeText(hash.slice(2));
  if (hash.startsWith('z=')) {
    const bytes = await pipe(fromBase64Url(hash.slice(2)), new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(bytes);
  }
  const params = new URLSearchParams(loc.search);
  const seq = params.get('sequence');
  if (seq) return decodeLegacy(seq);
  return null;
}

/* ---------------- legacy (v1, 2019) links ---------------- */

interface LegacyFraction {
  s?: number;
  n: number;
  d: number;
}
interface LegacyBlock {
  metre?: string | { num: number | string; denom: LegacyFraction | number | string };
  tempo?: { unit: LegacyFraction | number; bpm: number | string };
  bars?: number | string;
  rehearsal?: string;
}

async function decodeLegacy(seq: string): Promise<string> {
  const attempt = async (s: string) => {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    const out = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(out)) as LegacyBlock[];
  };
  let blocks: LegacyBlock[];
  try {
    blocks = await attempt(seq);
  } catch {
    blocks = await attempt(decodeURIComponent(seq));
  }
  return serialize(legacyToPiece(blocks));
}

export function legacyToPiece(blocks: LegacyBlock[]): Piece {
  const frac = (f: LegacyFraction | number | string): number =>
    typeof f === 'object' ? ((f.s ?? 1) * f.n) / f.d : Number(f);
  const items = blocks.map((b): BlockItem => {
    const item: BlockItem = { kind: 'bars', id: newId(), bars: Math.max(1, Number(b.bars ?? 1) || 1) };
    if (b.rehearsal !== undefined) item.mark = String(b.rehearsal);
    if (typeof b.metre === 'string') {
      const [n, d] = b.metre.split('/').map(Number);
      if (n && d) item.metre = { num: n, denom: d };
    } else if (b.metre) {
      item.metre = { num: Number(b.metre.num), denom: frac(b.metre.denom) };
    }
    if (b.tempo) {
      // v1 stored the unit as a note-value number (4 = crotchet).
      const base = frac(b.tempo.unit);
      item.tempo = { unit: { base, dots: 0 }, bpm: Number(b.tempo.bpm) };
    }
    return item;
  });
  return parse(serialize({ title: '', items })).piece;
}
