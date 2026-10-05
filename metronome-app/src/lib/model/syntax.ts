/**
 * Text syntax for metronome maps.
 *
 * Entries are separated by commas or new lines. Each entry is a block of bars,
 * a pause, or a repeat sign, made of space-separated tokens:
 *
 *   A:          rehearsal mark
 *   4/4  3+2/8  metre (optionally with additive grouping)
 *   c=120 q.=80 tempo (sb m c q sq ds hd, or 1 2 4 8 16 ..., dots for dotted)
 *   x8          number of bars (default 1)
 *   rit c=90    gradual tempo change across the block (also accel, rall, ~c=90)
 *   @17         renumber: this block starts at bar 17
 *   wait        pause until tapped;  wait 3s  timed pause
 *   |:  :|  :|x3   repeat signs (contents played twice, or x times)
 *
 * A first line starting with "#" is the title; other "//" or "#" lines are comments.
 */
import {
  metreToText,
  noteValueToText,
  parseNoteValue,
  tempoToText,
  wholesPerSecond,
} from './music';
import {
  newId,
  type BlockItem,
  type Item,
  type Metre,
  type PauseItem,
  type Piece,
  type RepeatItem,
  type Tempo,
} from './types';

export interface SyntaxError {
  line: number;
  message: string;
}

export interface ParseResult {
  piece: Piece;
  errors: SyntaxError[];
}

const GLIDE_WORDS = /^(rit|ritard|ritardando|rall|rallentando|accel|accelerando)\.?$/i;
const PAUSE_WORDS = /^(wait|tap|pause|fermata|gp|g\.p\.)$/i;

export function parseMetre(tok: string): Metre | undefined {
  const m = /^(\d+(?:\+\d+)*)\/(\d+)$/.exec(tok);
  if (!m) return undefined;
  const parts = m[1].split('+').map(Number);
  const denom = Number(m[2]);
  if (parts.some((p) => p < 1) || denom < 1) return undefined;
  const num = parts.reduce((a, b) => a + b, 0);
  return parts.length > 1 ? { num, denom, groups: parts } : { num, denom };
}

export function parseTempo(tok: string): Tempo | undefined {
  const m = /^([a-z0-9]+\.*)=(\d+(?:\.\d+)?)$/i.exec(tok);
  if (!m) return undefined;
  const unit = parseNoteValue(m[1].toLowerCase());
  const bpm = Number(m[2]);
  if (!unit || !(bpm > 0)) return undefined;
  return { unit, bpm };
}

interface Entry {
  text: string;
  line: number;
}

/** Split the text into entries and structural repeat signs, tracking line numbers. */
function entries(text: string): { title: string; list: Entry[] } {
  let title = '';
  const list: Entry[] = [];
  const lines = text.split(/\r?\n/);
  let seenContent = false;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      if (!seenContent && !title) title = trimmed.replace(/^#+\s*/, '');
      return;
    }
    if (trimmed.startsWith('//')) return;
    seenContent = true;
    const body = trimmed.replace(/\s\/\/.*$/, '');
    // Isolate repeat signs so they become their own entries.
    const spaced = body
      .replace(/\|:/g, ',|:,')
      .replace(/:\|\s*(x\s*\d+)?/gi, (_m, x) => `,:|${x ? x.replace(/\s+/g, '') : ''},`);
    for (const part of spaced.split(',')) {
      const t = part.trim();
      if (t) list.push({ text: t, line });
    }
  });
  return { title, list };
}

export function parse(text: string): ParseResult {
  const errors: SyntaxError[] = [];
  const { title, list } = entries(text);
  const root: Item[] = [];
  const stack: { items: Item[]; repeat?: RepeatItem; line: number }[] = [{ items: root, line: 0 }];
  const top = () => stack[stack.length - 1];

  for (const entry of list) {
    const { text: t, line } = entry;
    if (t === '|:') {
      const rep: RepeatItem = { kind: 'repeat', id: newId(), times: 2, items: [] };
      top().items.push(rep);
      stack.push({ items: rep.items, repeat: rep, line });
      continue;
    }
    const close = /^:\|(?:x(\d+))?$/i.exec(t);
    if (close) {
      const times = close[1] ? Number(close[1]) : 2;
      if (stack.length > 1) {
        const frame = stack.pop()!;
        frame.repeat!.times = Math.max(1, times);
      } else {
        // An end-repeat with no start repeats everything so far, as in notation.
        const rep: RepeatItem = { kind: 'repeat', id: newId(), times, items: root.splice(0) };
        root.push(rep);
      }
      continue;
    }
    const item = parseEntry(t, line, errors);
    if (item) top().items.push(item);
  }
  for (let i = stack.length - 1; i > 0; i--) {
    errors.push({ line: stack[i].line, message: 'Repeat start |: has no matching :|' });
  }
  // Drop empty repeats.
  const prune = (items: Item[]): Item[] =>
    items.filter((it) => {
      if (it.kind !== 'repeat') return true;
      it.items = prune(it.items);
      return it.items.length > 0;
    });
  return { piece: { title, items: prune(root) }, errors };
}

function parseEntry(t: string, line: number, errors: SyntaxError[]): Item | undefined {
  const tokens = t.split(/\s+/).filter(Boolean);
  let mark: string | undefined;
  let metre: Metre | undefined;
  let tempo: Tempo | undefined;
  let tempoTo: Tempo | undefined;
  let bars: number | undefined;
  let barNumber: number | undefined;
  let isPause = false;
  let seconds: number | undefined;
  let glideNext = false;
  const err = (message: string) => errors.push({ line, message });

  for (const tok of tokens) {
    let m: RegExpExecArray | null;
    if ((m = /^(.+):$/.exec(tok)) && !tok.includes('=')) {
      mark = m[1];
    } else if ((m = /^x(\d+)$/i.exec(tok))) {
      bars = Number(m[1]);
      if (bars < 1) err(`Bar count must be at least 1 ("${tok}")`);
    } else if ((m = /^@(-?\d+)$/.exec(tok))) {
      barNumber = Number(m[1]);
    } else if (PAUSE_WORDS.test(tok)) {
      isPause = true;
    } else if ((m = /^(\d+(?:\.\d+)?)s(ec|ecs|econds?)?$/i.exec(tok))) {
      seconds = Number(m[1]);
    } else if (GLIDE_WORDS.test(tok)) {
      glideNext = true;
    } else if (tok.startsWith('~') || tok.startsWith('->')) {
      const tp = parseTempo(tok.replace(/^(~|->)/, ''));
      if (tp) tempoTo = tp;
      else err(`Unrecognised tempo change "${tok}"`);
    } else if (parseMetre(tok)) {
      metre = parseMetre(tok);
    } else if (parseTempo(tok)) {
      if (glideNext) {
        tempoTo = parseTempo(tok);
        glideNext = false;
      } else {
        tempo = parseTempo(tok);
      }
    } else if (isPause && /^\d+(\.\d+)?$/.test(tok)) {
      seconds = Number(tok);
    } else {
      err(`Unrecognised "${tok}"`);
    }
  }
  if (glideNext) err('rit./accel. needs a target tempo, e.g. "rit c=90"');

  if (isPause) {
    if (metre || tempo || tempoTo || bars) err('A pause cannot also have bars, metre or tempo');
    const p: PauseItem = { kind: 'pause', id: newId() };
    if (seconds !== undefined) p.seconds = seconds;
    if (mark !== undefined) p.mark = mark;
    return p;
  }
  if (seconds !== undefined) err('Seconds only apply to a pause ("wait 2s")');

  const b: BlockItem = { kind: 'bars', id: newId(), bars: bars ?? 1 };
  if (mark !== undefined) b.mark = mark;
  if (metre) b.metre = metre;
  if (tempo) b.tempo = tempo;
  if (tempoTo) b.tempoTo = tempoTo;
  if (barNumber !== undefined) b.barNumber = barNumber;
  return b;
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

export interface SerializeOptions {
  british?: boolean;
}

export function serialize(piece: Piece, opts: SerializeOptions = {}): string {
  const british = opts.british ?? true;
  const out: string[] = [];
  if (piece.title) out.push(`# ${piece.title}`);
  // Each output line is built from comma-separated entries.
  let line: string[] = [];
  const flush = () => {
    if (line.length) out.push(line.join(', '));
    line = [];
  };
  let lastTempo: Tempo | undefined;
  // Start a new line, unless the line so far is just an opening repeat sign.
  const breakLine = () => {
    if (!(line.length === 1 && line[0] === '|:')) flush();
  };

  const emit = (items: Item[]) => {
    for (const it of items) {
      if (it.kind === 'repeat') {
        flush();
        line.push('|:');
        emit(it.items);
        const close = it.times === 2 ? ':|' : `:| x${it.times}`;
        // Attach the close sign to the last entry for readability.
        if (line.length) line[line.length - 1] += ' ' + close;
        else out[out.length - 1] += ' ' + close;
        flush();
        continue;
      }
      const toks: string[] = [];
      if (it.mark !== undefined) toks.push(`${it.mark}:`);
      if (it.kind === 'pause') {
        breakLine();
        toks.push('wait');
        if (it.seconds !== undefined) toks.push(`${it.seconds}s`);
        line.push(toks.join(' '));
        flush();
        continue;
      }
      if (it.barNumber !== undefined) toks.push(`@${it.barNumber}`);
      if (it.tempo) {
        toks.push(tempoToText(it.tempo, british));
        lastTempo = it.tempo;
      }
      if (it.metre) toks.push(metreToText(it.metre));
      if (it.bars !== 1) toks.push(`x${it.bars}`);
      if (it.tempoTo) {
        const from = it.tempo ?? lastTempo;
        const slower = from ? wholesPerSecond(it.tempoTo) < wholesPerSecond(from) : true;
        toks.push(slower ? 'rit' : 'accel', tempoToText(it.tempoTo, british));
        lastTempo = it.tempoTo;
      }
      if (it.mark !== undefined) breakLine();
      // A bare "1 bar, inherit everything" block needs some text: write x1.
      line.push(toks.length ? toks.join(' ') : 'x1');
    }
  };
  // Join the "|:" opener with the first entry of its line.
  emit(piece.items);
  flush();
  return out.map((l) => l.replace(/^\|:, /, '|: ').replace(/, \|:, /g, ', |: ')).join('\n');
}

export { noteValueToText };
