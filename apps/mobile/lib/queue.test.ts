import { describe, expect, it } from 'vitest';
import { createQueue, uuidv7, type QueueStore, type QueuedEvent, type SyncAnswer } from './queue';

const memory = (): QueueStore => {
  let events: QueuedEvent[] = [];
  return {
    put: async (e) => void (events = [...events.filter((x) => x.eventId !== e.eventId), e]),
    all: async () => events,
    remove: async (ids) => void (events = events.filter((e) => !ids.includes(e.eventId))),
  };
};
const event = (n: number): QueuedEvent => ({
  eventId: uuidv7((k) => crypto.getRandomValues(new Uint8Array(k)), 1_700_000_000_000 + n),
  deviceId: 'phone',
  actorId: 'teacher',
  occurredAt: new Date().toISOString(),
  type: 'attendance.mark',
  payload: { sectionId: 's', onDate: '2026-11-04', marks: [] },
});

describe('offline queue', () => {
  it('keeps everything while offline, and drops each event once the server has answered it', async () => {
    let online = false;
    const sent: string[][] = [];
    const q = createQueue(memory(), async (events) => {
      if (!online) throw new TypeError('Network request failed');
      sent.push(events.map((e) => e.eventId));
      return events.map((e): SyncAnswer => ({ eventId: e.eventId, outcome: 'accepted' }));
    });
    const counts: number[] = [];
    q.subscribe((n) => counts.push(n));
    await q.enqueue(event(1));
    await q.enqueue(event(2));
    expect(await q.flush()).toEqual([]);
    expect(await q.pending()).toHaveLength(2);
    online = true;
    expect((await q.flush()).map((a) => a.outcome)).toEqual(['accepted', 'accepted']);
    expect(await q.pending()).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(counts.at(-1)).toBe(0);
  });

  it('two flushes at once send once', async () => {
    let calls = 0;
    const q = createQueue(memory(), async (events) => {
      calls++;
      return events.map((e): SyncAnswer => ({ eventId: e.eventId, outcome: 'accepted' }));
    });
    await q.enqueue(event(3));
    await Promise.all([q.flush(), q.flush()]);
    expect(calls).toBe(1);
  });

  it('makes time-ordered UUIDv7 ids', () => {
    const a = uuidv7((k) => crypto.getRandomValues(new Uint8Array(k)), 1_700_000_000_000);
    const b = uuidv7((k) => crypto.getRandomValues(new Uint8Array(k)), 1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
