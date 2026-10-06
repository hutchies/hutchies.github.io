/**
 * Checks a deployed sync server (pocketbase/). Skipped unless a server is given:
 *
 *   METRONOME_PB_URL=https://hutchies.cc npm test
 *
 * It creates a throwaway room, which the server deletes after 24 hours.
 */
import { describe, expect, it } from 'vitest';
import { randomKey, RoomApi } from '../src/lib/sync/room';

const url = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.METRONOME_PB_URL;

describe.skipIf(!url)('sync server', () => {
  const api = new RoomApi(url ?? '');
  const hostKey = randomKey();

  it('serves the time, rooms, cues and members', async () => {
    const before = Date.now();
    const now = await api.time();
    expect(Math.abs(now - before)).toBeLessThan(60_000);

    const room = await api.createRoom(hostKey, { name: 'test', map: 'A: 4/4 x2' });
    expect(room.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(room.isHost).toBe(true);
    expect((await api.getRoom(room.code)).isHost).toBe(false);
    expect((await api.getRoom(room.code, hostKey)).isHost).toBe(true);

    await expect(api.sendCue(room.code, randomKey(), { kind: 'stop', at: now + 1000, payload: {}, by: '' })).rejects.toMatchObject({
      status: 403,
    });
    const cue = await api.sendCue(room.code, hostKey, { kind: 'start', at: now + 3000, payload: { sync: { top: true } }, by: 'x' });
    expect(cue.seq).toBeGreaterThan(0);
    const late = await api.sendCue(room.code, hostKey, { kind: 'stop', at: 0, payload: {}, by: 'x' });
    expect(late.seq).toBe(cue.seq + 1);
    expect(late.at).toBeGreaterThanOrEqual(now);
    expect((await api.listCues(room.code, cue.seq - 1)).map((c) => c.kind)).toEqual(['start', 'stop']);

    const updated = await api.updateRoom(room.code, hostKey, {
      map: '== A\n4/4\n== B\n3/4',
      settings: { releaseLeadMs: 200, assign: { someone: 'B' } },
    });
    expect(updated.settings).toEqual({ releaseLeadMs: 200, assign: { someone: 'B' } });
    expect((await api.getRoom(room.code)).map).toContain('== B');

    const memberKey = randomKey();
    const me = { clientId: 'test', displayName: 'T', part: '', kind: 'app' as const, ready: true, rttMs: 1, offsetErrMs: 1, countInSec: 2 };
    const res = await api.heartbeat(room.code, memberKey, me);
    expect(res.members.map((m) => m.clientId)).toContain('test');
    await expect(api.heartbeat(room.code, randomKey(), me)).rejects.toMatchObject({ status: 403 });
    await api.leave(room.code, memberKey, 'test');
  });

  it('only shows cues to clients that know the room code', async () => {
    const room = await api.createRoom(randomKey(), {});
    const base = url!.replace(/\/+$/, '') + '/api/collections/metronome_cues/records';
    const anon = await (await fetch(base)).json();
    expect(anon.items).toEqual([]);
    const ok = await fetch(base, { headers: { 'X-Room-Code': room.code } });
    expect(ok.status).toBe(200);
  });
});
