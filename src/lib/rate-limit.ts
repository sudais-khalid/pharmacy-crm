const hits = new Map<string, { count: number; reset: number }>();

/** Simple in-memory limiter (per server instance). Returns true if the call is allowed. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  h.count += 1;
  return h.count <= max;
}

export function clearLimit(key: string) {
  hits.delete(key);
}
