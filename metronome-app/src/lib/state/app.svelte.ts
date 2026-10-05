import { Engine } from '../audio/engine';
import { DEFAULT_SOUND, type SoundConfig } from '../audio/sounds';
import { barAt, compile, countIn, type CountInSpec, type Timeline } from '../model/compile';
import { decodeLocation, encodePiece } from '../model/share';
import { parse, serialize, type SyntaxError } from '../model/syntax';
import type { Item, Piece } from '../model/types';

export type Status = 'stopped' | 'countin' | 'playing' | 'held' | 'paused';

export interface Settings {
  tempoPercent: number;
  countIn: CountInSpec;
  subdivide: number;
  sound: SoundConfig;
  pxPerSecond: number;
  playhead: number;
  /** Display delay calibration, ms. */
  visualOffsetMs: number;
  british: boolean;
  theme: 'auto' | 'light' | 'dark';
  flashScreen: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  tempoPercent: 100,
  countIn: { amount: 1, unit: 'bars' },
  subdivide: 1,
  sound: DEFAULT_SOUND,
  pxPerSecond: 140,
  playhead: 0.25,
  visualOffsetMs: 0,
  british: true,
  theme: 'auto',
  flashScreen: false,
};

export const EXAMPLE = `# Example: mixed metres
A: c=120 4/4 x4
B: 3/4 x2, 5/8, 3+3+2/8 x2
|: C: q.=80 6/8 x4 :|
wait
D: c=96 7/8 x3, 4/4 x2 rit c=72
E: c=132 2+2+3/8 x4`;

export interface LibraryEntry {
  id: string;
  title: string;
  text: string;
  updated: number;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export class AppState {
  piece = $state<Piece>(parse(EXAMPLE).piece);
  /** Text-editor contents (may differ from the canonical serialisation while typing). */
  text = $state(EXAMPLE);
  errors = $state<SyntaxError[]>([]);
  editingText = $state(false);

  settings = $state<Settings>(load('metronome.settings', DEFAULT_SETTINGS));
  library = $state<LibraryEntry[]>(loadLibrary());

  status = $state<Status>('stopped');
  /** Bar under the playhead. */
  currentBar = $state(0);
  /** Where Play starts from when stopped (score seconds). */
  startPoint = $state(0);
  loopOn = $state(false);
  /** Loop range as bar indices (inclusive); null = whole piece. */
  loopRange = $state<{ from: number; to: number } | null>(null);
  /** Item selected in the builder (for highlighting). */
  selectedId = $state<string | null>(null);
  /** Focus view: only the rolling click strip, filling the screen. */
  focus = $state(false);

  timeline: Timeline = $derived(compile(this.piece, { subdivide: this.settings.subdivide }));

  loopRegion = $derived.by(() => {
    if (!this.loopOn) return null;
    const bars = this.timeline.bars;
    if (!bars.length) return null;
    if (!this.loopRange) return { start: 0, end: this.timeline.duration };
    const from = Math.min(this.loopRange.from, bars.length - 1);
    const to = Math.min(Math.max(this.loopRange.to, from), bars.length - 1);
    return { start: bars[from].start, end: bars[to].end };
  });

  engine = new Engine();

  constructor() {
    this.engine.setSound($state.snapshot(this.settings.sound));
    this.engine.visualOffset = this.settings.visualOffsetMs / 1000;
  }

  /* ---------- editing ---------- */

  setText(text: string) {
    this.text = text;
    const res = parse(text);
    this.errors = res.errors;
    this.piece = res.piece;
  }

  /** Re-derive the text from the piece (after builder edits). */
  syncText() {
    this.text = serialize(this.piece, { british: this.settings.british });
    this.errors = [];
  }

  loadText(text: string) {
    this.stop();
    this.setText(text);
    if (!this.errors.length) this.syncText();
    this.startPoint = 0;
    this.loopRange = null;
    this.selectedId = null;
  }

  async loadFromLocation() {
    try {
      const text = await decodeLocation(location);
      if (text !== null) {
        this.loadText(text);
        return true;
      }
    } catch (e) {
      console.warn('Could not decode piece from URL', e);
    }
    return false;
  }

  async updateUrl() {
    const hash = await encodePiece($state.snapshot(this.piece) as Piece);
    const url = new URL(location.href);
    url.search = '';
    url.hash = hash;
    history.replaceState(null, '', url);
  }

  persistSettings() {
    save('metronome.settings', $state.snapshot(this.settings));
    this.engine.setSound($state.snapshot(this.settings.sound));
    this.engine.visualOffset = this.settings.visualOffsetMs / 1000;
  }

  /* ---------- library ---------- */

  saveToLibrary() {
    const text = serialize(this.piece, { british: this.settings.british });
    const title = this.piece.title || 'Untitled';
    const existing = this.library.find((e) => e.title === title);
    if (existing) {
      existing.text = text;
      existing.updated = Date.now();
    } else {
      this.library.unshift({ id: crypto.randomUUID(), title, text, updated: Date.now() });
    }
    save('metronome.library', $state.snapshot(this.library));
  }

  deleteFromLibrary(id: string) {
    this.library = this.library.filter((e) => e.id !== id);
    save('metronome.library', $state.snapshot(this.library));
  }

  /* ---------- transport ---------- */

  get rate() {
    return this.settings.tempoPercent / 100;
  }

  async play() {
    const tl = this.timeline;
    if (!tl.bars.length) return;
    let from = this.startPoint;
    if (this.status === 'paused') {
      from = this.engine.position().score;
      // With a count-in, restart from the top of the bar so the count lines up.
      if (this.settings.countIn.amount > 0) from = tl.bars[barAt(tl, from)].start;
    } else if (this.loopRegion && (from < this.loopRegion.start || from >= this.loopRegion.end)) {
      from = this.loopRegion.start;
    }
    if (from >= tl.duration - 1e-6) from = 0;
    const bar = barAt(tl, from);
    const ci = countIn(tl, bar, this.settings.countIn);
    this.status = ci.duration > 0 ? 'countin' : 'playing';
    await this.engine.play({
      from,
      rate: this.rate,
      loop: this.loopRegion ? { ...this.loopRegion } : null,
      countIn: ci,
    });
  }

  pause() {
    if (this.status === 'stopped' || this.status === 'paused') return;
    this.engine.pause();
    this.status = 'paused';
  }

  stop() {
    this.engine.park(this.startPoint);
    this.status = 'stopped';
  }

  toggle() {
    if (this.status === 'held') {
      this.tap();
      return;
    }
    if (this.status === 'stopped' || this.status === 'paused') void this.play();
    else this.pause();
  }

  /** Enter or leave the focus view, taking the page fullscreen where the browser allows it. */
  setFocus(on: boolean) {
    if (this.focus === on) return;
    this.focus = on;
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (on && !doc.fullscreenElement && !doc.webkitFullscreenElement) {
        if (root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        else root.webkitRequestFullscreen?.();
      } else if (!on && (doc.fullscreenElement || doc.webkitFullscreenElement)) {
        if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
        else doc.webkitExitFullscreen?.();
      }
    } catch {
      /* fullscreen unavailable (e.g. iPhone): the focus view still fills the window */
    }
  }

  tap(): boolean {
    if (this.status !== 'held') return false;
    return this.engine.release();
  }

  setTempoPercent(p: number) {
    this.settings.tempoPercent = Math.max(10, Math.min(300, Math.round(p)));
    this.engine.update({ rate: this.rate });
    this.persistSettings();
  }

  /** Move the start point (and the parked playhead) to a bar. */
  seekBar(index: number) {
    const bars = this.timeline.bars;
    if (!bars.length) return;
    const i = Math.max(0, Math.min(index, bars.length - 1));
    this.startPoint = bars[i].start;
    this.currentBar = i;
    if (this.status === 'stopped' || this.status === 'paused') {
      this.engine.park(this.startPoint);
      this.status = 'stopped';
    } else {
      // Jump while playing: restart from there (with count-in).
      this.engine.park(this.startPoint);
      this.status = 'stopped';
      void this.play();
    }
  }

  seekScore(score: number) {
    const tl = this.timeline;
    const s = Math.max(0, Math.min(score, tl.duration));
    this.startPoint = s;
    this.engine.park(s);
    this.status = 'stopped';
    this.currentBar = Math.max(0, barAt(tl, s));
  }

  /** Jump to previous/next rehearsal mark (or bar if none). */
  stepMark(dir: 1 | -1) {
    const tl = this.timeline;
    const cur = this.currentBar;
    const marks = tl.marks.map((m) => m.barIndex).filter((i) => i < tl.bars.length);
    const targets = marks.length ? [0, ...marks] : tl.bars.map((_, i) => i);
    const uniq = [...new Set(targets)].sort((a, b) => a - b);
    const next = dir > 0 ? uniq.find((i) => i > cur) : [...uniq].reverse().find((i) => i < cur);
    if (next !== undefined) this.seekBar(next);
  }

  stepBar(dir: 1 | -1) {
    this.seekBar(this.currentBar + dir);
  }

  /** Bar index range covered by an item (for highlighting and looping). */
  barsForItem(id: string): { from: number; to: number } | null {
    const bars = this.timeline.bars;
    let from = -1;
    let to = -1;
    const ids = new Set<string>();
    const collect = (items: Item[], inside: boolean) => {
      for (const it of items) {
        const hit = inside || it.id === id;
        if (hit && it.kind !== 'repeat') ids.add(it.id);
        if (it.kind === 'repeat') collect(it.items, hit);
      }
    };
    collect(this.piece.items, false);
    bars.forEach((b, i) => {
      if (ids.has(b.itemId)) {
        if (from < 0) from = i;
        to = i;
      }
    });
    return from < 0 ? null : { from, to };
  }

  /** Mark sections: from each mark to the bar before the next. */
  sections = $derived.by(() => {
    const tl = this.timeline;
    const marks = tl.marks.filter((m) => m.barIndex < tl.bars.length);
    return marks.map((m, i) => ({
      label: m.pass && m.pass > 1 ? `${m.label} (${m.pass})` : m.label,
      from: m.barIndex,
      to: (i + 1 < marks.length ? marks[i + 1].barIndex : tl.bars.length) - 1,
    })).filter((s) => s.to >= s.from);
  });

  loopSection(from: number, to: number) {
    this.loopRange = { from, to };
    this.loopOn = true;
    if (this.status === 'stopped') this.seekBar(from);
  }
}

function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem('metronome.library');
    return raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

export const app = new AppState();
