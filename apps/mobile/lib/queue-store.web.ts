// The web test build keeps the queue in localStorage (phones use SQLite).
import type { QueueStore, QueuedEvent } from './queue';

const KEY = 'cv_sync_queue';
const read = (): QueuedEvent[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedEvent[];
  } catch {
    return [];
  }
};
const write = (events: QueuedEvent[]) => localStorage.setItem(KEY, JSON.stringify(events));

export const queueStore: QueueStore = {
  async put(e) {
    write([...read().filter((x) => x.eventId !== e.eventId), e]);
  },
  async all() {
    return read();
  },
  async remove(ids) {
    const gone = new Set(ids);
    write(read().filter((x) => !gone.has(x.eventId)));
  },
};
