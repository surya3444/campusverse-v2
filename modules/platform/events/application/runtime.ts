import type { Db } from '@campusverse/db';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { runConsumer, type Consumer, type QueueName } from './consumers.js';
import { relayOutbox, type OutboxEvent } from './outbox.js';

/** Delayed internal work that is not an event, such as "fall back if still unread in 24 hours". */
export type Task = {
  name: string;
  queue: QueueName;
  run: (db: Db, data: unknown) => Promise<void>;
};
export type Schedule = (task: string, data: unknown, delayMs: number) => Promise<void>;

const JOB_DEFAULTS = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 14 * 24 * 3600 },
} as const;

/**
 * BullMQ wiring for consumers and tasks. Jobs carry only ids; handlers reload from Postgres.
 * The job id is consumer + event id, so the same event is queued once while its job exists;
 * runConsumer's processed-event row covers everything after that.
 */
export function createRuntime(opts: {
  db: Db;
  connection: ConnectionOptions;
  consumers: Consumer[];
  tasks?: Task[];
  prefix?: string;
}) {
  const { db, connection, consumers, tasks = [] } = opts;
  const prefix = opts.prefix ?? 'cv';
  const queues = new Map<QueueName, Queue>();
  const queue = (name: QueueName) => {
    let q = queues.get(name);
    if (!q) queues.set(name, (q = new Queue(name, { connection, prefix })));
    return q;
  };

  async function publish(events: OutboxEvent[]) {
    for (const event of events) {
      for (const c of consumers.filter((c) => c.events.includes(event.type))) {
        await queue(c.queue).add(c.name, event, {
          ...JOB_DEFAULTS,
          jobId: `${c.name}-${event.id}`,
        });
      }
    }
  }

  const schedule: Schedule = async (name, data, delayMs) => {
    const task = tasks.find((t) => t.name === name);
    if (!task) throw new Error(`schedule: unknown task ${name}`);
    await queue(task.queue).add(name, data, { ...JOB_DEFAULTS, delay: delayMs });
  };

  function startWorkers(): Worker[] {
    const names = new Set<QueueName>([
      ...consumers.map((c) => c.queue),
      ...tasks.map((t) => t.queue),
    ]);
    return [...names].map(
      (name) =>
        new Worker(
          name,
          async (job) => {
            const consumer = consumers.find((c) => c.name === job.name);
            if (consumer) return runConsumer(db, consumer, job.data as OutboxEvent);
            const task = tasks.find((t) => t.name === job.name);
            if (task) return task.run(db, job.data);
            throw new Error(`No handler for job ${job.name}`);
          },
          { connection, prefix, concurrency: 8 },
        ),
    );
  }

  return {
    /** One relay pass. Call on an interval; safe to run on several workers at once. */
    relay: (limit?: number) => relayOutbox(db, publish, limit),
    publish,
    schedule,
    queue,
    startWorkers,
    close: async () => Promise.all([...queues.values()].map((q) => q.close())),
  };
}

export type Runtime = ReturnType<typeof createRuntime>;

/** BullMQ connection from REDIS_URL. Workers must wait for Redis, so retries are unlimited. */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
