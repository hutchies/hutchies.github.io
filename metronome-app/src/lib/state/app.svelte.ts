import { Engine } from '../audio/engine';
import { DEFAULT_SOUND, type SoundConfig } from '../audio/sounds';
import { barAt, compile, countIn, resumeBeats, resumeCountIn, type CountInSpec, type ResumeCountIn, type Timeline } from '../model/compile';
import {
  audibleParts,
  defaultSound,
  DEFAULT_PART_NAME,
  parseProject,
  serializeProject,
  uniqueName,
  type PartSound,
  type Project,
} from '../model/project';
import { decodeLocation, encodeText } from '../model/share';
import type { SyntaxError } from '../model/syntax';
import type { Item, Piece } from '../model/types';
import type { LayerTrack, TrackMix } from '../audio/worklet';
import { resolveSyncPoint, syncPointAt, type SyncPoint } from '../sync/cues';
import type { GroupSession, JoinOptions } from '../sync/group.svelte';
import { DEFAULT_SERVER } from '../sync/session';
import { newBlock } from '../model/tree';

export type Status = 'stopped' | 'countin' | 'playing' | 'held' | 'paused';

export interface Settings {
  tempoPercent: number;
  countIn: CountInSpec;
  /** Upbeat when continuing from a tap-to-continue pause. */
  resumeCountIn: ResumeCountIn;
  subdivide: number;
  sound: SoundConfig;
  pxPerSecond: number;
  playhead: number;
  /** Display delay calibration, ms. */
  visualOffsetMs: number;
  /**
   * How far this player's taps land from a flash (touchscreen lag plus their
   * own anticipation), ms, from the latency test's flash round. It depends on
   * the player and device, not the headphones, so it is measured once.
   */
  tapBiasMs: number | null;
  british: boolean;
  theme: 'auto' | 'light' | 'dark';
  /** Group sync: PocketBase server URL. */
  syncServer: string;
  /** Group sync: how this player appears to the others. */
  groupName: string;
  groupPart: string;
  /** Visual beat cue: none, the whole display (downbeats), or the screen edges (every beat). */
  flash: 'off' | 'display' | 'edges';
  /** Silence the clicks (for following the display or the edge flash alone). */
  muted: boolean;
  /** Rows in the focus view: 0 picks by screen shape (more rows in portrait). */
  focusRows: number;
  /** Show every part as its own lane in the display. */
  stackParts: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  tempoPercent: 100,
  countIn: { amount: 1, unit: 'bars' },
  resumeCountIn: 'auto',
  subdivide: 1,
  sound: DEFAULT_SOUND,
  pxPerSecond: 140,
  playhead: 0.25,
  visualOffsetMs: 0,
  tapBiasMs: null,
  british: true,
  theme: 'auto',
  syncServer: DEFAULT_SERVER,
  groupName: '',
  groupPart: '',
  flash: 'off',
  muted: false,
  focusRows: 0,
  stackParts: false,
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

function loadSettings(): Settings {
  const s = load<Settings & { flashScreen?: boolean }>('metronome.settings', DEFAULT_SETTINGS);
  // Earlier versions had a single on/off "flash on downbeats".
  if ('flashScreen' in s) {
    if (s.flashScreen && s.flash === 'off') s.flash = 'display';
    delete s.flashScreen;
  }
  return s;
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
  /** All parts (maps). The active one is shown, edited, and drives the transport. */
  project = $state<Project>(parseProject(EXAMPLE).project);
  activeIndex = $state(0);
  /** This device's mixer: part names muted or soloed. */
  mix = $state<{ muted: string[]; solo: string[] }>({ muted: [], solo: [] });
  /** Text-editor contents: the whole project (may differ from the canonical serialisation while typing). */
  text = $state(EXAMPLE);
  errors = $state<SyntaxError[]>([]);
  editingText = $state(false);

  settings = $state<Settings>(loadSettings());
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
  /** The block editor panel is open. */
  editorOpen = $state(false);
  /**
   * Parts made with Duplicate, by name, with a snapshot of the part they were
   * copied from (item id -> JSON), so the editor can mark what has changed.
   * This session only.
   */
  duplicates = $state<Record<string, { from: string; items: Record<string, string> }>>({});

  get activePart() {
    const parts = this.project.parts;
    return parts[Math.max(0, Math.min(this.activeIndex, parts.length - 1))];
  }

  /** The active part's map. */
  get piece(): Piece {
    return this.activePart.piece;
  }

  timeline: Timeline = $derived(compile(this.piece, { subdivide: this.settings.subdivide }));

  /** Every part's timeline (the active one is `timeline`). */
  partTimelines: Timeline[] = $derived(
    this.project.parts.map((p, i) =>
      i === this.activeIndex ? this.timeline : compile(p.piece, { subdivide: this.settings.subdivide }),
    ),
  );

  /** Part names heard on this device. */
  audible = $derived(audibleParts(this.project.parts.map((p) => p.name), this.mix.muted, this.mix.solo));

  /** Where the other parts line up with the active one: set on each start. */
  private layerAnchor: { sync: SyncPoint; from: number } = { sync: { top: true }, from: 0 };

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

  /** The group this device is playing with, if any. */
  group = $state.raw<GroupSession | null>(null);

  /** In a group, and this device controls playback. */
  get leading(): boolean {
    return !!this.group?.isLeader;
  }

  /** In a group, and someone else controls playback. */
  get following(): boolean {
    return !!this.group && !this.group.isLeader;
  }

  /** Tempo percentage in force: the leader's when following. */
  get tempoPercent(): number {
    return this.following ? (this.group?.playback?.tempoPercent ?? 100) : this.settings.tempoPercent;
  }

  constructor() {
    this.applySound();
    this.engine.visualOffset = this.settings.visualOffsetMs / 1000;
  }

  /* ---------- editing ---------- */

  /** The whole project as text. */
  projectText(): string {
    return serializeProject(this.project, { british: this.settings.british });
  }

  setText(text: string) {
    this.text = text;
    const res = parseProject(text);
    this.errors = res.errors;
    this.setProject(res.project);
  }

  /** Replace the project, keeping the active part (by name) where possible. */
  private setProject(project: Project, activeName = this.activePart?.name) {
    this.project = project;
    const i = project.parts.findIndex((p) => p.name === activeName);
    this.activeIndex = Math.max(0, i);
  }

  /** Re-derive the text from the project (after builder edits). */
  syncText() {
    this.text = this.projectText();
    this.errors = [];
  }

  loadText(text: string, activeName?: string) {
    // In a group, playback carries on: the cue log is replayed against the new map.
    if (!this.group) this.stop();
    this.text = text;
    const res = parseProject(text);
    this.errors = res.errors;
    this.setProject(res.project, activeName);
    if (!this.errors.length) this.syncText();
    this.startPoint = 0;
    this.loopRange = null;
    this.selectedId = null;
  }

  /* ---------- parts ---------- */

  setActivePart(i: number) {
    if (i === this.activeIndex || i < 0 || i >= this.project.parts.length) return;
    if (this.following) return; // the leader assigns parts
    if (!this.group) this.halt();
    this.activeIndex = i;
    this.startPoint = 0;
    this.loopRange = null;
    this.selectedId = null;
  }

  /** Adds a new part with one block of 4/4. */
  addPart() {
    const names = this.project.parts.map((p) => p.name);
    // Name the existing single part too, so the project gets headers.
    if (names.length === 1 && names[0] === DEFAULT_PART_NAME) {
      this.project.parts[0].name = 'Part 1';
      names[0] = 'Part 1';
    }
    const piece: Piece = { title: '', items: [newBlock()] };
    this.project.parts.push({ name: uniqueName(`Part ${names.length + 1}`, names), piece, sound: defaultSound() });
    this.setActivePart(this.project.parts.length - 1);
  }

  /** Copies a part (blocks and sound) as the start of a new one, and shows it. */
  duplicatePart(i = this.activeIndex) {
    const src = this.project.parts[i];
    if (!src) return;
    const names = this.project.parts.map((p) => p.name);
    let srcName = src.name;
    if (names.length === 1 && srcName === DEFAULT_PART_NAME) {
      src.name = srcName = 'Part 1';
      names[0] = srcName;
    }
    const piece = structuredClone($state.snapshot(src.piece)) as Piece;
    const sound = structuredClone($state.snapshot(src.sound)) as PartSound;
    const name = uniqueName(`${srcName} copy`, names);
    this.project.parts.splice(i + 1, 0, { name, piece, sound });
    this.duplicates[name] = { from: srcName, items: itemSnapshot(piece.items) };
    this.setActivePart(i + 1);
    this.editorOpen = true;
  }

  /** For a duplicated part: whether an item differs from the part it was copied from. */
  itemChange(id: string): 'changed' | 'new' | null {
    const d = this.duplicates[this.activePart.name];
    if (!d) return null;
    const loc = findItem(this.piece.items, id);
    if (!loc) return null;
    const before = d.items[id];
    if (before === undefined) return 'new';
    return before === itemKey(loc) ? null : 'changed';
  }

  /** Score offset of part i from the active part at active score `score`, as heard. */
  partOffset(i: number, score: number): number {
    const tl = this.partTimelines[i];
    if (!tl?.bars.length || i === this.activeIndex) return 0;
    const playing = this.status !== 'stopped' && this.status !== 'paused';
    if (playing) return resolveSyncPoint(tl, this.layerAnchor.sync) - this.layerAnchor.from;
    return resolveSyncPoint(tl, syncPointAt(this.timeline, score)) - score;
  }

  removePart(i: number) {
    const parts = this.project.parts;
    if (parts.length <= 1) return;
    const name = parts[i].name;
    parts.splice(i, 1);
    delete this.duplicates[name];
    this.mix.muted = this.mix.muted.filter((n) => n !== name);
    this.mix.solo = this.mix.solo.filter((n) => n !== name);
    if (this.activeIndex >= parts.length || i < this.activeIndex) this.activeIndex = Math.max(0, this.activeIndex - 1);
    if (parts.length === 1 && parts[0].name === 'Part 1') parts[0].name = DEFAULT_PART_NAME;
  }

  renamePart(i: number, name: string) {
    const parts = this.project.parts;
    const old = parts[i].name;
    const next = uniqueName(name, parts.filter((_, j) => j !== i).map((p) => p.name));
    if (next === old) return;
    parts[i].name = next;
    if (this.duplicates[old]) {
      this.duplicates[next] = this.duplicates[old];
      delete this.duplicates[old];
    }
    const swap = (list: string[]) => list.map((n) => (n === old ? next : n));
    this.mix.muted = swap(this.mix.muted);
    this.mix.solo = swap(this.mix.solo);
    this.group?.partRenamed(old, next);
  }

  setPartSound(i: number, sound: Partial<PartSound>) {
    Object.assign(this.project.parts[i].sound, sound);
  }

  toggleMutePart(name: string) {
    const m = this.mix.muted;
    this.mix.muted = m.includes(name) ? m.filter((n) => n !== name) : [...m, name];
  }

  toggleSoloPart(name: string) {
    const s = this.mix.solo;
    this.mix.solo = s.includes(name) ? s.filter((n) => n !== name) : [...s, name];
  }

  /** Hear only this part. */
  soloOnly(name: string) {
    this.mix.solo = [name];
    this.mix.muted = [];
  }

  /** Line up the other parts with the active one, from a start at `from` (active score time). */
  setLayerAnchor(sync: SyncPoint, from: number) {
    this.layerAnchor = { sync, from };
    this.pushLayers();
  }

  /** Sends the other parts (and the mix) to the audio engine. */
  pushLayers() {
    const parts = this.project.parts;
    const tls = this.partTimelines;
    const audible = this.audible;
    const mixFor = (sound: PartSound, heard: boolean): TrackMix => ({
      timbre: sound.timbre,
      gain: heard ? sound.volume : 0,
      pitchMul: Math.pow(2, sound.transpose / 12),
    });
    const active = this.activePart;
    const main = mixFor(active.sound, audible.has(active.name));
    const { sync, from } = this.layerAnchor;
    const layers: LayerTrack[] = [];
    let end = 0;
    parts.forEach((p, i) => {
      if (i === this.activeIndex || !audible.has(p.name) || !tls[i]?.bars.length) return;
      const offset = resolveSyncPoint(tls[i], sync) - from;
      layers.push({
        ...mixFor($state.snapshot(p.sound) as PartSound, true),
        times: tls[i].clickTimes,
        levels: tls[i].clickLevels,
        offset,
      });
      // An indefinite part keeps playback going after the active part ends.
      if (tls[i].open) end = Math.max(end, tls[i].duration - offset);
    });
    this.engine.setLayers(main, layers, end);
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
    const hash = await encodeText(this.projectText());
    const url = new URL(location.href);
    url.search = '';
    url.hash = hash;
    history.replaceState(null, '', url);
  }

  persistSettings() {
    save('metronome.settings', $state.snapshot(this.settings));
    this.applySound();
    this.engine.visualOffset = this.settings.visualOffsetMs / 1000;
  }

  private applySound() {
    const sound = $state.snapshot(this.settings.sound);
    if (this.settings.muted) sound.volume = 0;
    this.engine.setSound(sound);
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.persistSettings();
  }

  /* ---------- library ---------- */

  saveToLibrary() {
    const text = this.projectText();
    const title = this.project.title || 'Untitled';
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
    if (this.following) return;
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
    if (this.leading) {
      this.group!.start(from);
      return;
    }
    const bar = barAt(tl, from);
    const ci = countIn(tl, bar, this.settings.countIn);
    this.status = ci.duration > 0 ? 'countin' : 'playing';
    this.setLayerAnchor(syncPointAt(tl, from), from);
    await this.engine.play({
      from,
      rate: this.rate,
      loop: this.loopRegion ? { ...this.loopRegion } : null,
      countIn: ci,
    });
  }

  pause() {
    if (this.status === 'stopped' || this.status === 'paused' || this.following) return;
    if (this.leading) {
      this.group!.pause();
      return;
    }
    this.engine.pause();
    this.status = 'paused';
  }

  stop() {
    if (this.following) return;
    if (this.leading) {
      this.group!.stop();
      return;
    }
    this.halt();
  }

  /** Stop this device only (also used when the piece ends). */
  halt() {
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
    if (this.status !== 'held' || this.following) return false;
    if (this.leading) {
      this.group!.release();
      return true;
    }
    const at = this.engine.heldAt();
    if (at === null) return false;
    const beats = resumeBeats(this.timeline, at, this.rate, this.settings.resumeCountIn);
    return this.engine.release(resumeCountIn(this.timeline, at, beats));
  }

  /**
   * Following a group: continue from a pause on this device only. Normally
   * the leader releases pauses; this is the way out when this map pauses
   * somewhere the leader's doesn't. (Deliberately not on Space or pedals.)
   */
  continueAlone() {
    if (this.status === 'held' && this.following) this.group!.releaseLocally();
  }

  setTempoPercent(p: number) {
    if (this.following) return;
    this.settings.tempoPercent = Math.max(10, Math.min(300, Math.round(p)));
    if (this.leading) this.group!.update({ tempoPercent: this.settings.tempoPercent });
    else this.engine.update({ rate: this.rate });
    this.persistSettings();
  }

  /** Whether the user may move the start point right now. */
  get canSeek(): boolean {
    return !this.following || this.status === 'stopped' || this.status === 'paused';
  }

  /** Move the start point (and the parked playhead) to a bar. */
  seekBar(index: number) {
    const bars = this.timeline.bars;
    if (!bars.length || !this.canSeek) return;
    const i = Math.max(0, Math.min(index, bars.length - 1));
    this.startPoint = bars[i].start;
    this.currentBar = i;
    if (this.status === 'stopped' || this.status === 'paused') {
      this.engine.park(this.startPoint);
      this.status = 'stopped';
      if (this.leading) this.group!.seek(this.startPoint);
    } else if (this.leading) {
      // Jump while playing: everyone restarts from there.
      this.group!.start(this.startPoint);
    } else {
      // Jump while playing: restart from there (with count-in).
      this.engine.park(this.startPoint);
      this.status = 'stopped';
      void this.play();
    }
  }

  seekScore(score: number) {
    if (!this.canSeek) return;
    const tl = this.timeline;
    const s = Math.max(0, Math.min(score, tl.duration));
    this.startPoint = s;
    this.engine.park(s);
    this.status = 'stopped';
    this.currentBar = Math.max(0, barAt(tl, s));
    if (this.leading) this.group!.seek(s);
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

  /* ---------- group ---------- */

  /** Create (no code) or join a room. Call from a user gesture, so audio can start. */
  async joinGroup(opts: Omit<JoinOptions, 'server'> & { server?: string }) {
    // Start audio first, while we still have the user's tap: followers play
    // without one. Without a tap (rejoining after a reload) this never
    // resolves, so don't wait long; the group bar offers "Enable sound".
    const audio = this.engine.start().catch(() => {});
    await Promise.race([audio, new Promise((r) => setTimeout(r, 1500))]);
    await this.leaveGroup();
    const server = (opts.server || this.settings.syncServer || DEFAULT_SERVER).trim();
    this.halt();
    // Loaded on demand: solo players never download the PocketBase client.
    const { GroupSession } = await import('../sync/group.svelte');
    const g = new GroupSession(this, { ...opts, server });
    this.group = g;
    try {
      await g.connect();
    } catch (e) {
      if (this.group === g) this.group = null;
      throw e;
    }
  }

  async leaveGroup() {
    const g = this.group;
    if (!g) return;
    this.group = null;
    this.halt();
    await g.leave();
  }

  loopSection(from: number, to: number) {
    this.loopRange = { from, to };
    this.loopOn = true;
    if (this.status === 'stopped') this.seekBar(from);
  }
}

/** An item's content without its children (a repeat's own settings only). */
function itemKey(it: Item): string {
  const copy: Record<string, unknown> = { ...$state.snapshot(it) };
  if (it.kind === 'repeat') delete copy.items;
  return JSON.stringify(copy);
}

function itemSnapshot(items: Item[], out: Record<string, string> = {}): Record<string, string> {
  for (const it of items) {
    out[it.id] = itemKey(it);
    if (it.kind === 'repeat') itemSnapshot(it.items, out);
  }
  return out;
}

function findItem(items: Item[], id: string): Item | null {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.kind === 'repeat') {
      const f = findItem(it.items, id);
      if (f) return f;
    }
  }
  return null;
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
