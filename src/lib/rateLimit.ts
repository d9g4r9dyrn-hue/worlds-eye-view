/**
 * A small fixed-window rate limiter for the two public API routes.
 *
 * Neither route calls a paid API, so the risk here is server load and
 * upstream abuse rather than runaway spend: without a limit, anyone can
 * point a loop at /api/cams/thumb and turn this app into a free proxy
 * that hammers a state DOT's camera servers on their behalf. The agencies
 * publishing these feeds are the ones who'd feel that, which is reason
 * enough to cap it.
 *
 * Limits are deliberately generous, because normal use is genuinely
 * request-heavy: a single map view fetches one catalogue query plus up to
 * ~140 frames, and refreshes a slice of those every couple of minutes.
 * The point is to stop a script, not to police a browser.
 *
 * In-memory and per-process, matching everything else here. On a single
 * Railway replica that's exactly right; it would need Redis only if this
 * ever scaled horizontally, which it shouldn't (see DEPLOY.md).
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Bounded so a flood of unique IPs can't grow the map without limit. Well
 * above any plausible number of real concurrent visitors.
 */
const MAX_TRACKED_KEYS = 20_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // If everything is still live and we're somehow over the cap, drop the
  // oldest entries — Map preserves insertion order.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const excess = buckets.size - MAX_TRACKED_KEYS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/**
 * Best-effort client identity.
 *
 * Behind Railway the socket address is the proxy, so the real client is
 * the first entry of x-forwarded-for. That header is spoofable in
 * general, but here it's set by the platform's own edge, and the
 * consequence of a spoof is only that an abuser splits themselves across
 * more buckets — no worse than not having a limit at all.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — used for Retry-After. */
  retryAfter: number;
}

export function checkRateLimit(request: Request, scope: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // Cheap amortised cleanup rather than a timer, so an idle process isn't
  // kept awake just to expire buckets.
  if (buckets.size > 512 && Math.floor(now / 1000) % 60 === 0) sweep(now);

  const key = `${scope}:${clientKey(request)}`;
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    ok: bucket.count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - bucket.count),
    retryAfter,
  };
}

/** Standard headers so a well-behaved client can back off on its own. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.retryAfter),
  };
}
