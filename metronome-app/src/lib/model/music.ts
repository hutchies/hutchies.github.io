import type { Metre, NoteValue, Tempo } from './types';

/** Length of a note value in whole notes (semibreves). */
export function noteLength(v: NoteValue): number {
  let len = 1 / v.base;
  let add = len;
  for (let i = 0; i < v.dots; i++) {
    add /= 2;
    len += add;
  }
  return len;
}

/** Tempo expressed as whole notes per second; the common currency for all maths. */
export function wholesPerSecond(t: Tempo): number {
  return (t.bpm * noteLength(t.unit)) / 60;
}

/** Seconds per pulse of the given metre at a constant tempo. */
export function pulseSeconds(m: Metre, t: Tempo): number {
  return 1 / m.denom / wholesPerSecond(t);
}

export function metreEquals(a: Metre, b: Metre): boolean {
  return (
    a.num === b.num &&
    a.denom === b.denom &&
    (a.groups ?? []).join('+') === (b.groups ?? []).join('+')
  );
}

export function tempoEquals(a: Tempo, b: Tempo): boolean {
  return a.bpm === b.bpm && a.unit.base === b.unit.base && a.unit.dots === b.unit.dots;
}

/**
 * Pulse grouping used for accents. Explicit groups win; otherwise compound
 * metres (6/8, 9/8, 12/16 ...) group in threes and everything else gives
 * every pulse its own beat.
 */
export function effectiveGroups(m: Metre): number[] {
  if (m.groups && m.groups.length) return m.groups;
  if (m.denom >= 8 && m.num > 3 && m.num % 3 === 0) {
    return Array(m.num / 3).fill(3);
  }
  return Array(m.num).fill(1);
}

/** True when the metre has pulses that are not beats (i.e. groups larger than 1). */
export function isGrouped(m: Metre): boolean {
  return effectiveGroups(m).some((g) => g > 1);
}

const BRITISH: Record<number, string> = {
  1: 'sb',
  2: 'm',
  4: 'c',
  8: 'q',
  16: 'sq',
  32: 'ds',
  64: 'hd',
};
const FROM_BRITISH: Record<string, number> = Object.fromEntries(
  Object.entries(BRITISH).map(([k, v]) => [v, Number(k)]),
);

const NAMES: Record<number, [string, string]> = {
  1: ['semibreve', 'whole note'],
  2: ['minim', 'half note'],
  4: ['crotchet', 'quarter note'],
  8: ['quaver', 'eighth note'],
  16: ['semiquaver', 'sixteenth note'],
  32: ['demisemiquaver', '32nd note'],
  64: ['hemidemisemiquaver', '64th note'],
};

export function noteName(v: NoteValue, british = true): string {
  const n = NAMES[v.base]?.[british ? 0 : 1] ?? `1/${v.base} note`;
  return (v.dots === 1 ? 'dotted ' : v.dots === 2 ? 'double-dotted ' : '') + n;
}

/** Parse "c", "q.", "4", "8.", "sq" etc. Returns undefined if not a note value. */
export function parseNoteValue(s: string): NoteValue | undefined {
  const m = /^([a-z]+|\d+)(\.*)$/.exec(s);
  if (!m) return undefined;
  const base = /^\d+$/.test(m[1]) ? Number(m[1]) : FROM_BRITISH[m[1]];
  if (!base || base & (base - 1)) return undefined; // must be a power of two
  return { base, dots: m[2].length };
}

export function noteValueToText(v: NoteValue, british = true): string {
  const b = british ? (BRITISH[v.base] ?? String(v.base)) : String(v.base);
  return b + '.'.repeat(v.dots);
}

export function tempoToText(t: Tempo, british = true): string {
  return `${noteValueToText(t.unit, british)}=${formatNumber(t.bpm)}`;
}

export function metreToText(m: Metre): string {
  const top = m.groups && m.groups.length > 1 ? m.groups.join('+') : String(m.num);
  return `${top}/${m.denom}`;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Equivalent bpm of `t` expressed in the note value `unit`. */
export function convertTempo(t: Tempo, unit: NoteValue): Tempo {
  return { unit, bpm: (wholesPerSecond(t) * 60) / noteLength(unit) };
}
