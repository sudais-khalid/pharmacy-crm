import { platformDb } from "./platform-db";

/**
 * Sliding-window limiter backed by PostgreSQL, so limits hold across restarts and server processes.
 * Callers record only the events they want to limit (for login: failed attempts).
 */
export async function isLimited(bucket: string, max: number, windowMs: number, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - windowMs);
  const count = await platformDb.rateLimitHit.count({ where: { bucket, at: { gt: since } } });
  return count >= max;
}

export async function recordHit(bucket: string, now = new Date()) {
  await platformDb.rateLimitHit.create({ data: { bucket, at: now } });
}

export async function clearBucket(bucket: string) {
  await platformDb.rateLimitHit.deleteMany({ where: { bucket } });
}

/** Removes hits older than the longest window in use. Scheduled by the worker. */
export async function purgeRateLimitHits(olderThanMs = 24 * 3600 * 1000, now = new Date()) {
  const { count } = await platformDb.rateLimitHit.deleteMany({ where: { at: { lt: new Date(now.getTime() - olderThanMs) } } });
  return count;
}
