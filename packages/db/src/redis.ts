import { Redis } from 'ioredis';

export type { Redis };

/**
 * Redis is a speed layer, never the source of truth. Commands fail fast instead of queueing
 * while disconnected, so callers can fall back to Postgres (or refuse, for OTP) at once.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    enableOfflineQueue: false,
    commandTimeout: 500,
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
}
