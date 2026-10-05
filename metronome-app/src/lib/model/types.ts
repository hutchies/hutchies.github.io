/**
 * Piece structure: the authored, editable representation of a metronome map.
 *
 * A piece is a list of items. Blocks of bars inherit metre and tempo from
 * whatever came before them, so most blocks only state what changes.
 */

/** A note value such as a crotchet (base 4) or dotted quaver (base 8, dots 1). */
export interface NoteValue {
  /** 1 = semibreve, 2 = minim, 4 = crotchet, 8 = quaver, ... */
  base: number;
  dots: number;
}

export interface Tempo {
  unit: NoteValue;
  bpm: number;
}

export interface Metre {
  /** Number of pulses per bar (the top number). */
  num: number;
  /** Pulse note value (the bottom number). */
  denom: number;
  /**
   * Explicit pulse grouping, e.g. [3, 2, 2] for 3+2+2/8. Must sum to num.
   * When absent a default grouping is derived (see `effectiveGroups`).
   */
  groups?: number[];
}

export interface BlockItem {
  kind: 'bars';
  id: string;
  bars: number;
  metre?: Metre;
  /** Tempo at the start of the block (inherited if absent). */
  tempo?: Tempo;
  /** If set, tempo glides (rit./accel.) from the start tempo to this across the block. */
  tempoTo?: Tempo;
  /** Rehearsal mark shown on the first bar of the block. */
  mark?: string;
  /** Renumber: the first bar of this block gets this bar number. */
  barNumber?: number;
}

export interface PauseItem {
  kind: 'pause';
  id: string;
  /** Seconds of silence; undefined means "wait until tapped". */
  seconds?: number;
  mark?: string;
}

export interface RepeatItem {
  kind: 'repeat';
  id: string;
  /** Total number of times the contents are played (2 = play twice). */
  times: number;
  items: Item[];
}

export type Item = BlockItem | PauseItem | RepeatItem;

export interface Piece {
  title: string;
  items: Item[];
}

export const DEFAULT_TEMPO: Tempo = { unit: { base: 4, dots: 0 }, bpm: 120 };
export const DEFAULT_METRE: Metre = { num: 4, denom: 4 };

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `i${Date.now().toString(36)}${idCounter.toString(36)}`;
}
