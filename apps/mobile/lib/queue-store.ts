// Phones keep the offline queue in SQLite (Build Guide, "Offline sync").
import * as SQLite from 'expo-sqlite';
import type { QueueStore, QueuedEvent } from './queue';

let opened: Promise<SQLite.SQLiteDatabase> | null = null;
const db = () =>
  (opened ??= SQLite.openDatabaseAsync('campusverse-sync.db').then(async (d) => {
    await d.execAsync(
      'create table if not exists events (event_id text primary key, body text not null, created_at integer not null)',
    );
    return d;
  }));

export const queueStore: QueueStore = {
  async put(e) {
    await (
      await db()
    ).runAsync('insert or replace into events (event_id, body, created_at) values (?, ?, ?)', [
      e.eventId,
      JSON.stringify(e),
      Date.now(),
    ]);
  },
  async all() {
    const rows = await (
      await db()
    ).getAllAsync<{ body: string }>('select body from events order by created_at');
    return rows.map((r) => JSON.parse(r.body) as QueuedEvent);
  },
  async remove(eventIds) {
    const d = await db();
    for (const id of eventIds) await d.runAsync('delete from events where event_id = ?', [id]);
  },
};
