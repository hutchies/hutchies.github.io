/**
 * Thin client for the metronome group API on PocketBase (see
 * pocketbase/pb_hooks/metronome.pb.js). Writes go through custom routes that
 * check the room's host key; new cues arrive over PocketBase realtime (SSE).
 */
import PocketBase, { type UnsubscribeFunc } from 'pocketbase';
import type { Cue, CueKind } from './cues';
import type { MemberKind } from './session';

export interface RoomSettings {
  /** Delay between the leader's tap and everyone continuing from a pause, ms. */
  releaseLeadMs: number;
}

export interface RoomInfo {
  id: string;
  code: string;
  name: string;
  /** Shared map in the text syntax ('' if none). */
  map: string;
  settings: RoomSettings;
  expires: string;
  updated: string;
  isHost?: boolean;
}


export interface MemberInfo {
  clientId: string;
  displayName: string;
  part: string;
  kind: MemberKind;
  ready: boolean;
  leader: boolean;
  rttMs: number;
  offsetErrMs: number;
  countInSec: number;
  updated: string;
}

export interface MemberUpdate {
  clientId: string;
  displayName: string;
  part: string;
  kind: MemberKind;
  ready: boolean;
  rttMs: number;
  offsetErrMs: number;
  countInSec: number;
}

/** A random URL-safe secret. */
export function randomKey(bytes = 18): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toCue(r: Record<string, unknown>): Cue {
  return {
    seq: Number(r.seq),
    kind: r.kind as CueKind,
    at: Number(r.at),
    payload: (r.payload as Record<string, unknown>) ?? {},
    by: (r.by as string) ?? '',
  };
}

export class RoomApi {
  readonly pb: PocketBase;

  constructor(server: string) {
    this.pb = new PocketBase(server.replace(/\/+$/, ''));
    this.pb.autoCancellation(false);
  }

  /** The server's clock, ms since the epoch. */
  async time(): Promise<number> {
    const res = await this.pb.send<{ now: number }>('/api/metronome/time', { method: 'GET', cache: 'no-store' });
    return res.now;
  }

  createRoom(hostKey: string, data: { name?: string; map?: string; settings?: RoomSettings }): Promise<RoomInfo> {
    return this.pb.send('/api/metronome/rooms', { method: 'POST', headers: { 'X-Host-Key': hostKey }, body: data });
  }

  getRoom(code: string, hostKey?: string): Promise<RoomInfo> {
    return this.pb.send(`/api/metronome/rooms/${encodeURIComponent(code)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: hostKey ? { 'X-Host-Key': hostKey } : {},
    });
  }

  updateRoom(
    code: string,
    hostKey: string,
    data: { name?: string; map?: string; settings?: RoomSettings; by?: string },
  ): Promise<RoomInfo> {
    return this.pb.send(`/api/metronome/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'X-Host-Key': hostKey },
      body: data,
    });
  }

  async listCues(code: string, after = 0): Promise<Cue[]> {
    const rows = await this.pb.send<Record<string, unknown>[]>(
      `/api/metronome/rooms/${encodeURIComponent(code)}/cues`,
      { method: 'GET', cache: 'no-store', query: { after } },
    );
    return rows.map(toCue);
  }

  async sendCue(
    code: string,
    hostKey: string,
    cue: { kind: CueKind; at: number; payload: object; by: string },
  ): Promise<Cue> {
    const row = await this.pb.send<Record<string, unknown>>(`/api/metronome/rooms/${encodeURIComponent(code)}/cues`, {
      method: 'POST',
      headers: { 'X-Host-Key': hostKey },
      body: cue,
    });
    return toCue(row);
  }

  heartbeat(
    code: string,
    memberKey: string,
    me: MemberUpdate,
    hostKey?: string,
  ): Promise<{ member: MemberInfo; members: MemberInfo[]; room: RoomInfo }> {
    const headers: Record<string, string> = { 'X-Member-Key': memberKey };
    if (hostKey) headers['X-Host-Key'] = hostKey;
    return this.pb.send(`/api/metronome/rooms/${encodeURIComponent(code)}/members`, {
      method: 'POST',
      headers,
      body: me,
    });
  }

  async leave(code: string, memberKey: string, clientId: string): Promise<void> {
    await this.pb.send(
      `/api/metronome/rooms/${encodeURIComponent(code)}/members/${encodeURIComponent(clientId)}`,
      { method: 'DELETE', headers: { 'X-Member-Key': memberKey } },
    );
  }

  /**
   * Calls `onCue` for each new cue in the room, and `onReconnect` whenever the
   * realtime connection is (re)established, so missed cues can be fetched.
   */
  async subscribe(
    room: RoomInfo,
    onCue: (cue: Cue) => void,
    onReconnect: () => void,
  ): Promise<UnsubscribeFunc> {
    const offConnect = await this.pb.realtime.subscribe('PB_CONNECT', () => onReconnect());
    const offCues = await this.pb.collection('metronome_cues').subscribe(
      '*',
      (e) => {
        if (e.action === 'create' && e.record.room === room.id) onCue(toCue(e.record));
      },
      { filter: `room = "${room.id}"`, headers: { 'X-Room-Code': room.code } },
    );
    return async () => {
      await offCues().catch(() => {});
      await offConnect().catch(() => {});
    };
  }

  disconnect() {
    this.pb.realtime.unsubscribe().catch(() => {});
  }
}
