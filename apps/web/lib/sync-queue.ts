// Browser offline queue for attendance and bus marks (the Expo app keeps the same queue in SQLite). Every
// submission is stored first and then sent, so nothing is lost if the network drops mid-way.
// The event id is made here (UUIDv7), and the server accepts each id once, so resending is safe.
import { useCallback, useEffect, useState } from 'react';

export type QueuedEvent = {
  eventId: string;
  deviceId: string;
  actorId: string;
  occurredAt: string;
  /** For the pending list: "Class 4-A, 4 Nov". */
  label: string;
} & (
  | {
      type: 'attendance.mark';
      payload: {
        sectionId: string;
        onDate: string;
        marks: { personId: string; status: string }[];
      };
    }
  | {
      // One tap of the bus attendant.
      type: 'transport.mark';
      payload: { institutionId: string; tripId: string; personId: string; kind: string };
    }
);
export type SyncAnswer = {
  eventId: string;
  outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  code?: string;
  conflicts?: number;
};

const DB = 'campusverse-sync';
const STORE = 'events';
const CHANGED = 'campusverse-sync-changed';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'eventId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** UUIDv7: 48-bit milliseconds, then random bits, so ids sort by time. */
export function uuidv7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A stable id for this browser, so the school can see which device an offline mark came from. */
export function deviceId(): string {
  try {
    const known = localStorage.getItem('cv_device_id');
    if (known) return known;
    const id = uuidv7();
    localStorage.setItem('cv_device_id', id);
    return id;
  } catch {
    return 'browser';
  }
}

const notify = () => window.dispatchEvent(new Event(CHANGED));

export async function enqueue(event: QueuedEvent): Promise<void> {
  await run('readwrite', (s) => s.put(event));
  notify();
}

export const pending = () => run<QueuedEvent[]>('readonly', (s) => s.getAll());

let flushing: Promise<SyncAnswer[]> | null = null;

/**
 * Sends everything queued. Each answered event is final and leaves the queue; a network failure
 * or server error keeps them all for the next try. One flush at a time.
 */
export function flush(): Promise<SyncAnswer[]> {
  flushing ??= (async () => {
    try {
      const events = await pending();
      if (events.length === 0) return [];
      const res = await fetch('/api/v1/sync/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'campusverse' },
        // The label is for this screen only; the server gets the event as the device recorded it.
        body: JSON.stringify({
          events: events.map((e) => ({
            eventId: e.eventId,
            deviceId: e.deviceId,
            actorId: e.actorId,
            occurredAt: e.occurredAt,
            type: e.type,
            payload: e.payload,
          })),
        }),
      });
      if (!res.ok) return [];
      const { results } = (await res.json()) as { results: SyncAnswer[] };
      for (const r of results) await run('readwrite', (s) => s.delete(r.eventId));
      notify();
      return results;
    } catch {
      return [];
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** The pending count, kept current; sends again whenever the browser comes back online. */
export function useSyncQueue() {
  const [items, setItems] = useState<QueuedEvent[]>([]);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(() => {
    pending().then(setItems, () => setItems([]));
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener(CHANGED, refresh);
    // ponytail: retries every 20 s while anything is pending; a service worker's background sync can replace this.
    const retry = setInterval(() => {
      if (navigator.onLine) void flush();
    }, 20_000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener(CHANGED, refresh);
      clearInterval(retry);
    };
  }, [refresh]);

  return { items, count: items.length, online };
}
