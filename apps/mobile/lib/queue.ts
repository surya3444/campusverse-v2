// The offline attendance queue, the same protocol as the web (decision 0009): every submission is
// stored first, then sent; the server accepts each device-made event id once, so resending is safe.
// Every answer is final; only a network failure or server error keeps an event for the next try.

export type QueuedEvent = {
  eventId: string;
  deviceId: string;
  actorId: string;
  occurredAt: string;
  type: 'attendance.mark';
  payload: { sectionId: string; onDate: string; marks: { personId: string; status: string }[] };
};
export type SyncAnswer = {
  eventId: string;
  outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  code?: string;
};
export type QueueStore = {
  put(e: QueuedEvent): Promise<void>;
  all(): Promise<QueuedEvent[]>;
  remove(eventIds: string[]): Promise<void>;
};
export type Send = (events: QueuedEvent[]) => Promise<SyncAnswer[]>;

/** UUIDv7: 48-bit milliseconds, then random bits, so ids sort by time. */
export function uuidv7(random: (n: number) => Uint8Array, now = Date.now()): string {
  const b = random(16);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) % 256;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A queue over a store. One flush at a time; listeners hear every change in the pending count. */
export function createQueue(store: QueueStore, send: Send) {
  const listeners = new Set<(n: number) => void>();
  let flushing: Promise<SyncAnswer[]> | null = null;
  const changed = async () => {
    const n = (await store.all()).length;
    for (const l of listeners) l(n);
  };

  return {
    async enqueue(e: QueuedEvent) {
      await store.put(e);
      await changed();
    },
    pending: () => store.all(),
    flush(): Promise<SyncAnswer[]> {
      flushing ??= (async () => {
        try {
          const events = await store.all();
          if (events.length === 0) return [];
          const answers = await send(events);
          await store.remove(answers.map((a) => a.eventId));
          await changed();
          return answers;
        } catch {
          return []; // offline or server error: everything stays queued
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    },
    subscribe(l: (n: number) => void) {
      listeners.add(l);
      void changed();
      return () => void listeners.delete(l);
    },
  };
}
