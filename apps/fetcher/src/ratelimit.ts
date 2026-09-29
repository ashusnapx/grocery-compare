/**
 * Per-person sliding-window limit. One comparison is one request per platform,
 * so the default (60 platform searches / 10 min) is about 10 comparisons.
 * The fetcher is a single long-lived process, so an in-memory window is exact.
 */
const WINDOW_MS = 10 * 60 * 1000;
/**
 * Two buckets: full comparisons, and typing suggestions. Suggestions are
 * debounced client-side and served from cache mostly, so they get more room.
 */
const LIMITS = {
  search: Number(process.env.RATE_LIMIT_PER_10_MIN ?? 60),
  suggest: Number(process.env.SUGGEST_LIMIT_PER_10_MIN ?? 200),
};
export type Bucket = keyof typeof LIMITS;
const hits = new Map<string, number[]>();

export function isLoopback(ip: string | null): boolean {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.');
}

/** Returns true when the request may proceed. */
export function allow(ip: string | null, bucket: Bucket = 'search', now = Date.now()): boolean {
  // Local development talks from loopback and would otherwise trip the limit
  // while testing. Production traffic always carries the forwarded client IP.
  if (process.env.NODE_ENV !== 'production' && isLoopback(ip)) return true;
  const key = `${bucket}:${ip ?? 'unknown'}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[bucket]) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Forget idle clients so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
}, WINDOW_MS).unref();
