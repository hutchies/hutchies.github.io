/**
 * The lightweight side of group sync: constants, join links and the saved
 * session. Kept apart from group.svelte.ts so the PocketBase client is only
 * downloaded when someone actually joins a room.
 */

export const DEFAULT_SERVER = 'https://hutchies.cc';

/** Members not heard from for this long are shown as away and ignored for timing. */
export const STALE_MS = 30_000;

/** Countdown-only members hear 3, 2, 1, go. */
export const COUNTDOWN_SECONDS = 3;

export type MemberKind = 'app' | 'countdown';

const SESSION_KEY = 'metronome.group';

export interface SavedSession {
  server: string;
  code: string;
  kind: MemberKind;
}

export function savedSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function rememberSession(s: SavedSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function forgetSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function errorMessage(e: unknown): string {
  const err = e as { status?: number; response?: { message?: string }; message?: string };
  if (err?.status === 0) return 'Could not reach the sync server.';
  return err?.response?.message || err?.message || String(e);
}

/** Parses a `#join=CODE` or `#join=CODE.HOSTKEY` fragment (plus optional ?server=). */
export function parseJoinLink(loc: { hash: string; search: string }): { code: string; hostKey?: string; server?: string } | null {
  const m = /^#?join=([A-Za-z0-9]{5})(?:\.([A-Za-z0-9_-]{16,}))?$/.exec(loc.hash);
  if (!m) return null;
  const server = new URLSearchParams(loc.search).get('server') ?? undefined;
  return { code: normaliseCode(m[1]), hostKey: m[2], server };
}
