/**
 * A project: one or more parts (maps) that play together from the same
 * start, e.g. a conductor's map plus a percussionist's with different bar
 * groupings. Each part can have its own click sound.
 *
 * Text form: the usual syntax, with a `== Name` header line starting each
 * part. Options in brackets set the part's sound: a timbre, a volume and a
 * transposition in semitones, in any order.
 *
 *   # Title
 *   == Conductor
 *   A: c=120 4/4 x4
 *   == Percussion [bell, 70%, -5]
 *   A: c=120 2+2+3/8 x4
 *
 * A single part with the default name and sound has no header, so ordinary
 * maps are projects too and old links keep working.
 */
import type { Timbre } from '../audio/sounds';
import { parse, serialize, type SerializeOptions, type SyntaxError } from './syntax';
import type { Piece } from './types';

export interface PartSound {
  /** Overrides the global click sound (null = use it). */
  timbre: Timbre | null;
  /** 0–1, multiplies the global volume. */
  volume: number;
  /** Semitones, -24..24. */
  transpose: number;
}

export interface Part {
  name: string;
  piece: Piece;
  sound: PartSound;
}

export interface Project {
  title: string;
  parts: Part[];
}

export const DEFAULT_PART_NAME = 'Main';
export const TIMBRES: Timbre[] = ['wood', 'beep', 'click', 'bell'];

export function defaultSound(): PartSound {
  return { timbre: null, volume: 1, transpose: 0 };
}

const HEADER = /^==\s*(.*?)\s*(?:\[([^\]]*)\])?\s*$/;

function parseOptions(raw: string | undefined): PartSound {
  const s = defaultSound();
  for (const opt of (raw ?? '').split(/[\s,]+/).filter(Boolean)) {
    const o = opt.toLowerCase();
    if ((TIMBRES as string[]).includes(o)) s.timbre = o as Timbre;
    else if (/^\d+(\.\d+)?%$/.test(o)) s.volume = Math.max(0, Math.min(1, parseFloat(o) / 100));
    else if (/^[+-]\d+(\.\d+)?$/.test(o)) s.transpose = Math.max(-24, Math.min(24, parseFloat(o)));
  }
  return s;
}

function optionsText(s: PartSound): string {
  const opts: string[] = [];
  if (s.timbre) opts.push(s.timbre);
  if (s.volume !== 1) opts.push(`${Math.round(s.volume * 100)}%`);
  if (s.transpose) opts.push(`${s.transpose > 0 ? '+' : ''}${s.transpose}`);
  return opts.length ? ` [${opts.join(', ')}]` : '';
}

function isDefaultSound(s: PartSound) {
  return !s.timbre && s.volume === 1 && !s.transpose;
}

/** Makes part names unique and non-empty ("Part 2", "Bass (2)"). */
export function uniqueName(name: string, taken: string[]): string {
  const base = name.trim() || `Part ${taken.length + 1}`;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base} (${i})`;
    if (!taken.includes(n)) return n;
  }
}

export interface ProjectParseResult {
  project: Project;
  /** Line numbers are within the whole text. */
  errors: SyntaxError[];
}

export function parseProject(text: string): ProjectParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections: { name: string; sound: PartSound; start: number; lines: string[] }[] = [];
  let title = '';
  let current: (typeof sections)[number] | null = null;
  const preamble: string[] = [];
  lines.forEach((line, i) => {
    const h = HEADER.exec(line.trim());
    if (h && line.trim().startsWith('==')) {
      current = { name: h[1], sound: parseOptions(h[2]), start: i, lines: [] };
      sections.push(current);
      return;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  });
  // The preamble holds the title and, for a plain map (or content before the
  // first header), an implicit first part.
  const pre = parse(preamble.join('\n'));
  title = pre.piece.title;
  const errors: SyntaxError[] = [...pre.errors];
  const parts: Part[] = [];
  if (pre.piece.items.length || !sections.length) {
    parts.push({ name: DEFAULT_PART_NAME, piece: { ...pre.piece, title }, sound: defaultSound() });
  }
  for (const sec of sections) {
    // Keep line numbers: pad with the lines before the section body.
    const res = parse('\n'.repeat(sec.start + 1) + sec.lines.join('\n'));
    errors.push(...res.errors);
    const name = uniqueName(sec.name, parts.map((p) => p.name));
    parts.push({ name, piece: { ...res.piece, title }, sound: sec.sound });
  }
  return { project: { title, parts }, errors };
}

export function serializeProject(project: Project, opts: SerializeOptions = {}): string {
  const parts = project.parts;
  const plain = parts.length === 1 && parts[0].name === DEFAULT_PART_NAME && isDefaultSound(parts[0].sound);
  if (plain) return serialize({ ...parts[0].piece, title: project.title }, opts);
  const out: string[] = [];
  if (project.title) out.push(`# ${project.title}`);
  for (const p of parts) {
    out.push(`== ${p.name}${optionsText(p.sound)}`);
    const body = serialize({ ...p.piece, title: '' }, opts);
    if (body) out.push(body);
  }
  return out.join('\n');
}

/** Which parts are heard, given per-device mute and solo sets (by name). */
export function audibleParts(names: string[], muted: string[], solo: string[]): Set<string> {
  const soloed = names.filter((n) => solo.includes(n));
  return new Set(soloed.length ? soloed : names.filter((n) => !muted.includes(n)));
}
