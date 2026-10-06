/**
 * Group playback as a pure function of the room's cue log.
 *
 * Every cue carries the server-clock instant (`at`) at which it takes effect,
 * and every device replays the same log against its own map. The result is a
 * transport state whose times are in server seconds; the device shifts it into
 * its own AudioContext time and hands it to the engine. Because the reduction
 * is deterministic, a device that joins late (or reconnects) computes exactly
 * where everyone else is and comes in mid-piece.
 *
 * Positions are exchanged as sync points (a rehearsal mark plus a bar offset,
 * or a bar number), which each device resolves against its own map, so
 * players with different maps (parts, count-ins, renumbered bars) still land
 * on the same downbeat.
 */
import { positionAt, STOPPED, withPrev, type LoopRegion, type TransportState } from '../audio/transport';
import { barAt, countIn, resumeCountIn, type CountInSpec, type Timeline } from '../model/compile';

export interface SyncPoint {
  /** The start of the piece: resolves to every map's first bar. */
  top?: boolean;
  /** Rehearsal mark label. */
  mark?: string;
  /** Which occurrence of the mark (1-based; marks inside repeats occur more than once). */
  markPass?: number;
  /** Bars after the mark's first bar. */
  offset?: number;
  /** Written bar number (used when the mark isn't in this map). */
  bar?: number;
  /** Which occurrence of that bar number (1-based). */
  pass?: number;
  /** How far into the bar, 0–1 (absent = on the downbeat). */
  frac?: number;
}

/** A loop region in map-independent terms: whole piece, or first and last bar. */
export type LoopSpec = null | 'all' | { from: SyncPoint; to: SyncPoint };

export type CueKind = 'start' | 'stop' | 'pause' | 'release' | 'update' | 'seek' | 'room';

export interface StartPayload {
  sync: SyncPoint;
  tempoPercent: number;
  loop: LoopSpec;
}
export interface UpdatePayload {
  tempoPercent?: number;
  loop?: LoopSpec;
}
export interface SeekPayload {
  sync: SyncPoint;
}
/**
 * The cue's time is when the upbeat starts; the music continues `lead`
 * seconds later. Each map lays its own `beats` beats back from that downbeat.
 */
export interface ReleasePayload {
  beats: number;
  lead: number;
}

export interface Cue {
  seq: number;
  kind: CueKind;
  /** Server time (ms since epoch) at which the cue takes effect. */
  at: number;
  payload: Record<string, unknown>;
  by?: string;
}

/** Count-in clicks, in the same shape the engine uses. */
export interface ScheduledCountIn {
  times: number[];
  levels: number[];
  startTime: number;
  startScore: number;
  rate: number;
}

export interface GroupPlayback {
  /** Transport state; all times are server seconds. */
  state: TransportState;
  countIn: ScheduledCountIn | null;
  /** Where Stop returns to (this map's resolution of the last start or seek). */
  home: number;
  tempoPercent: number;
  mode: 'stopped' | 'playing' | 'paused';
  /** Server seconds of the last start's downbeat (null unless playing). */
  startAt: number | null;
  /** The last start or seek position, for lining up other parts with `home`. */
  sync: SyncPoint;
}

export interface LocalContext {
  timeline: Timeline;
  countIn: CountInSpec;
}

/* ---------------- sync points ---------------- */

/** Occurrences of each mark label that start a bar, in order. */
function markOccurrences(tl: Timeline, label: string) {
  return tl.marks.filter((m) => m.label === label && m.barIndex < tl.bars.length);
}

/** Describes a score position so other maps can find "the same place". */
export function syncPointAt(tl: Timeline, score: number): SyncPoint {
  const bi = barAt(tl, score);
  if (bi < 0) return { top: true };
  const bar = tl.bars[bi];
  const len = bar.end - bar.start;
  let frac = len > 0 ? (score - bar.start) / len : 0;
  frac = Math.round(Math.max(0, Math.min(1, frac)) * 1e6) / 1e6;
  if (frac >= 1) frac = 0;
  const sp: SyncPoint = {};
  if (bi === 0) sp.top = true;
  // The most recent mark at or before this bar.
  let mark: (typeof tl.marks)[number] | undefined;
  for (const m of tl.marks) {
    if (m.barIndex <= bi && m.barIndex < tl.bars.length) mark = m;
  }
  if (mark) {
    sp.mark = mark.label;
    sp.markPass = markOccurrences(tl, mark.label).indexOf(mark) + 1;
    sp.offset = bi - mark.barIndex;
  }
  sp.bar = bar.number;
  sp.pass = tl.bars.slice(0, bi).filter((b) => b.number === bar.number).length + 1;
  if (frac > 0) sp.frac = frac;
  return sp;
}

/** Bar index in this map for a sync point: mark first, then bar number, else the top. */
export function syncBarIndex(tl: Timeline, sp: SyncPoint): number {
  const n = tl.bars.length;
  if (!n || sp.top) return 0;
  if (sp.mark !== undefined) {
    const occ = markOccurrences(tl, sp.mark);
    if (occ.length) {
      const m = occ[Math.min(Math.max(1, sp.markPass ?? 1), occ.length) - 1];
      return Math.max(0, Math.min(n - 1, m.barIndex + (sp.offset ?? 0)));
    }
  }
  if (sp.bar !== undefined) {
    const matches: number[] = [];
    tl.bars.forEach((b, i) => b.number === sp.bar && matches.push(i));
    if (matches.length) return matches[Math.min(Math.max(1, sp.pass ?? 1), matches.length) - 1];
  }
  return 0;
}

/** Score time in this map for a sync point. */
export function resolveSyncPoint(tl: Timeline, sp: SyncPoint): number {
  if (!tl.bars.length) return 0;
  const bar = tl.bars[syncBarIndex(tl, sp)];
  return bar.start + (sp.frac ?? 0) * (bar.end - bar.start);
}

export function loopSpecFor(tl: Timeline, region: LoopRegion | null): LoopSpec {
  if (!region || !tl.bars.length) return null;
  if (region.start <= 1e-9 && region.end >= tl.duration - 1e-9) return 'all';
  const from = syncPointAt(tl, region.start);
  const last = Math.max(barAt(tl, region.start), barAt(tl, region.end - 1e-6));
  const to = syncPointAt(tl, tl.bars[last].start);
  delete from.frac;
  delete to.frac;
  return { from, to };
}

export function resolveLoop(tl: Timeline, spec: LoopSpec | undefined): LoopRegion | null {
  if (!spec || !tl.bars.length) return null;
  if (spec === 'all') return tl.duration > 0 ? { start: 0, end: tl.duration } : null;
  const i = syncBarIndex(tl, spec.from);
  const j = Math.max(i, syncBarIndex(tl, spec.to));
  return { start: tl.bars[i].start, end: tl.bars[j].end };
}

/* ---------------- reduction ---------------- */

export function initialPlayback(tl: Timeline): GroupPlayback {
  return {
    state: { ...STOPPED, end: tl.duration, holds: tl.holds },
    countIn: null,
    home: 0,
    tempoPercent: 100,
    mode: 'stopped',
    startAt: null,
    sync: { top: true },
  };
}

/** How long after a release the player waits to also release a hold it reaches late (s). */
const RELEASE_GRACE = 0.5;

function clampPercent(p: unknown, fallback: number): number {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(300, n)) : fallback;
}

/** Count-in clicks before T, so a stop or pause cancels the rest. */
function cutCountIn(ci: ScheduledCountIn | null, T: number): ScheduledCountIn | null {
  if (!ci) return null;
  const keep = ci.times.findIndex((t) => t >= T);
  if (keep < 0) return ci;
  return { ...ci, times: ci.times.slice(0, keep), levels: ci.levels.slice(0, keep) };
}

export function applyCue(p: GroupPlayback, cue: Cue, ctx: LocalContext): GroupPlayback {
  const tl = ctx.timeline;
  const T = cue.at / 1000;
  const st = p.state;
  const base = { end: tl.duration, holds: tl.holds };

  switch (cue.kind) {
    case 'start': {
      const pl = cue.payload as Partial<StartPayload>;
      const tempoPercent = clampPercent(pl.tempoPercent, p.tempoPercent);
      const rate = tempoPercent / 100;
      const sync = pl.sync ?? { top: true };
      const from = Math.min(resolveSyncPoint(tl, sync), tl.duration);
      const ci = countIn(tl, Math.max(0, barAt(tl, from)), ctx.countIn);
      const times = ci.offsets.map((o) => T + o / rate);
      // Until the downbeat, everyone waits silently at the new start (as a
      // local restart does), rather than carrying on with the previous run.
      const waiting: TransportState = { ...st, ...base, playing: false, anchorScore: from, releaseAtAnchor: false };
      return {
        state: withPrev(
          {
            ...base,
            playing: tl.bars.length > 0,
            anchorTime: T,
            anchorScore: from,
            rate,
            // Starting exactly on a tap-hold means "go", not "wait again".
            releaseAtAnchor: true,
            loop: resolveLoop(tl, pl.loop),
          },
          waiting,
        ),
        countIn: times.length ? { times, levels: ci.levels, startTime: T, startScore: from, rate } : null,
        home: from,
        tempoPercent,
        mode: 'playing',
        startAt: T,
        sync,
      };
    }

    case 'stop':
      return {
        ...p,
        state: withPrev({ ...st, ...base, playing: false, anchorTime: T, anchorScore: p.home, releaseAtAnchor: false }, st),
        countIn: cutCountIn(p.countIn, T),
        mode: 'stopped',
        startAt: null,
      };

    case 'pause': {
      if (!st.playing) return p;
      // Paused during the count-in: stay at the start.
      const score = T < st.anchorTime ? st.anchorScore : positionAt(st, T).score;
      return {
        ...p,
        state: withPrev({ ...st, playing: false, anchorTime: T, anchorScore: score, releaseAtAnchor: false }, st),
        countIn: cutCountIn(p.countIn, T),
        mode: 'paused',
        startAt: null,
      };
    }

    case 'release': {
      if (!st.playing || T < st.anchorTime) return p;
      let pos = positionAt(st, T);
      let at = T;
      if (pos.frozen?.kind !== 'hold') {
        // This map reaches its pause slightly later than the leader's did:
        // carry straight on when it gets there.
        const later = positionAt(st, T + RELEASE_GRACE);
        if (later.frozen?.kind !== 'hold') return p;
        at = T + Math.max(0, later.frozen.at - pos.score) / st.rate;
        pos = later;
      }
      const hold = pos.frozen!.at;
      const pl = cue.payload as Partial<ReleasePayload>;
      const beats = Math.max(0, Math.min(4, Math.round(Number(pl.beats) || 0)));
      const lead = Math.max(0, Math.min(10, Number(pl.lead) || 0));
      const downbeat = Math.max(at, T + lead);
      let countInOut: ScheduledCountIn | null = null;
      if (beats > 0) {
        const ci = resumeCountIn(tl, hold, beats);
        const times: number[] = [];
        const levels: number[] = [];
        ci.offsets.forEach((o, k) => {
          const t = downbeat + o / st.rate;
          // Upbeat clicks before the cue (a slower map) or before this map reaches its pause are dropped.
          if (t >= at - 1e-3) {
            times.push(t);
            levels.push(ci.levels[k]);
          }
        });
        if (times.length) countInOut = { times, levels, startTime: downbeat, startScore: hold, rate: st.rate };
      }
      return {
        ...p,
        state: withPrev({ ...st, anchorTime: downbeat, anchorScore: hold, releaseAtAnchor: true }, st),
        countIn: countInOut,
      };
    }

    case 'update': {
      const pl = cue.payload as UpdatePayload;
      const tempoPercent = clampPercent(pl.tempoPercent, p.tempoPercent);
      const rate = tempoPercent / 100;
      const loopChanged = pl.loop !== undefined;
      const loop = loopChanged ? resolveLoop(tl, pl.loop) : st.loop;
      if (!st.playing) {
        return { ...p, tempoPercent, state: withPrev({ ...st, anchorTime: T, rate, loop }, st) };
      }
      if (T < st.anchorTime) {
        // Still counting in: keep the start, adopt the new rate and loop.
        return { ...p, tempoPercent, state: { ...st, rate, loop } };
      }
      let score = positionAt(st, T).score;
      // A loop that is already behind us would never trigger: jump into it.
      if (loop && loopChanged && score >= loop.end) score = loop.start;
      return {
        ...p,
        tempoPercent,
        state: withPrev({ ...st, anchorTime: T, anchorScore: score, rate, loop, releaseAtAnchor: false }, st),
      };
    }

    case 'seek': {
      if (p.mode === 'playing') return p;
      const sync = (cue.payload as Partial<SeekPayload>).sync ?? { top: true };
      const home = resolveSyncPoint(tl, sync);
      return {
        ...p,
        home,
        sync,
        state: withPrev({ ...st, ...base, playing: false, anchorTime: T, anchorScore: home }, st),
        mode: 'stopped',
      };
    }

    default:
      return p;
  }
}

/** Replays a cue log (in sequence order) against this device's map. */
export function replay(cues: Iterable<Cue>, ctx: LocalContext): GroupPlayback {
  const sorted = [...cues].sort((a, b) => a.seq - b.seq);
  return sorted.reduce((p, c) => applyCue(p, c, ctx), initialPlayback(ctx.timeline));
}

/* ---------------- clock domains ---------------- */

/** Shifts a state's times by `delta` seconds (e.g. server -> AudioContext time). */
export function shiftState(st: TransportState, delta: number): TransportState {
  return { ...st, anchorTime: st.anchorTime + delta, prev: st.prev ? shiftState(st.prev, delta) : undefined };
}

export function shiftCountIn(ci: ScheduledCountIn | null, delta: number): ScheduledCountIn | null {
  if (!ci) return null;
  return { ...ci, times: ci.times.map((t) => t + delta), startTime: ci.startTime + delta };
}
