import sharp from "sharp";
import { isUrlSafeToFetch } from "@/lib/safeFetch";
import type { Cam } from "./types";

/**
 * Fetches and downscales camera frames.
 *
 * Two things make this worth having rather than pointing <img> straight
 * at the upstream URL:
 *
 * 1. Size. Upstream frames are full-resolution — 60-160KB each, and one
 *    viewport shows well over a hundred of them. Downscaled to thumbnail
 *    width they land around 6-12KB, which is the difference between a
 *    map that loads and one that doesn't.
 * 2. The CSP. Cameras live on dozens of third-party hosts across the
 *    feeds, and Windy adds dozens more. Serving every frame from our own
 *    origin means `img-src` stays `'self'` instead of growing an
 *    open-ended allowlist that would have to change whenever a source
 *    moves its buckets.
 *
 * The cache is in memory rather than on disk on purpose: frames expire in
 * minutes, so a disk cache would mostly store garbage while competing
 * with the digest archive for the same mounted volume. A cold start just
 * re-fetches.
 */

/** Thumbnail width on the map. Generous enough to stay sharp on a high-DPI screen. */
const THUMB_WIDTH = 320;

/** Total cache budget. Comfortably holds several thousand thumbnails. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

/** Refuse absurd upstream payloads before decoding them. */
const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;

/** Never re-fetch faster than this, whatever a feed claims its refresh rate is. */
const MIN_TTL_SECONDS = 45;

/**
 * Thresholds for spotting a "camera unavailable" placeholder card.
 *
 * Several DOT feeds answer a dead camera with HTTP 200 and a perfectly
 * valid JPEG that just says "Temporarily Unavailable" — so status codes
 * and content types can't catch it, and on a night map those white cards
 * are the brightest, loudest thing on screen.
 *
 * Measured across 30 live Bay Area frames, the split is unambiguous:
 *
 *   placeholder cards   86% near-white pixels, entropy ~2.08, mean ~231
 *   real camera frames  <7% near-white,        entropy 4.74-7.34
 *
 * The darkest real frame in that sample (a night camera, mean luminance
 * 17) still scored 4.74, so entropy alone separates them with a wide
 * margin. Brightness is required as well, deliberately: a genuinely dark
 * frame is *meaningful* — being able to see that it's night somewhere is
 * half the point of the map — so nothing dark is ever discarded, however
 * flat it is. Only a bright, flat, near-featureless image gets dropped.
 */
const PLACEHOLDER_MIN_MEAN = 200;
const PLACEHOLDER_MAX_ENTROPY = 3.5;

/**
 * How long to remember that a camera is down. Without this, a dead camera
 * is re-fetched and re-decoded on every single request, since only
 * successes go in the frame cache.
 */
const FAILURE_TTL_SECONDS = 120;

export interface CachedFrame {
  body: Buffer;
  contentType: string;
  fetchedAt: number;
}

interface CacheEntry extends CachedFrame {
  expiresAt: number;
}

/**
 * Pinned to globalThis for the same reason as the registry's state: Next
 * can compile a shared module into more than one server bundle, and a
 * per-bundle copy would quietly split this state in two. That matters
 * most for `failures`, which is written by the thumbnail route and read
 * by the viewport route — a split there would silently disable the
 * skip-dead-cameras behaviour, and the only symptom would be occasional
 * holes in the map.
 *
 * Map preserves insertion order, which is all the LRU needs: re-inserting
 * on read moves an entry to the back, so the oldest is always first.
 */
const globalForFrames = globalThis as typeof globalThis & {
  __wevFrameCache?: Map<string, CacheEntry>;
  __wevFrameInFlight?: Map<string, Promise<CachedFrame>>;
  __wevFrameFailures?: Map<string, number>;
  __wevFrameBytes?: { total: number };
};

const cache: Map<string, CacheEntry> = (globalForFrames.__wevFrameCache ??= new Map<string, CacheEntry>());

/**
 * Held in an object rather than a bare `let`, because a primitive can't
 * be shared by reference across bundles — the byte total would drift out
 * of step with the shared cache and eviction would stop working.
 */
const bytes: { total: number } = (globalForFrames.__wevFrameBytes ??= { total: 0 });

/** Concurrent requests for the same frame share one upstream fetch. */
const inFlight: Map<string, Promise<CachedFrame>> = (globalForFrames.__wevFrameInFlight ??= new Map<
  string,
  Promise<CachedFrame>
>());

/** cam id -> when it may be tried again. See FAILURE_TTL_SECONDS. */
const failures: Map<string, number> = (globalForFrames.__wevFrameFailures ??= new Map<string, number>());

function isFailing(key: string): boolean {
  const until = failures.get(key);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    failures.delete(key);
    return false;
  }
  return true;
}

function evictTo(limit: number) {
  for (const [key, entry] of cache) {
    if (bytes.total <= limit) break;
    cache.delete(key);
    bytes.total -= entry.body.byteLength;
  }
}

function readCache(key: string): CachedFrame | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    bytes.total -= entry.body.byteLength;
    return null;
  }

  // Touch: move to the back of the eviction queue.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeCache(key: string, frame: CachedFrame, ttlSeconds: number) {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    bytes.total -= existing.body.byteLength;
  }

  cache.set(key, { ...frame, expiresAt: Date.now() + ttlSeconds * 1000 });
  bytes.total += frame.body.byteLength;
  evictTo(MAX_CACHE_BYTES);
}

async function fetchUpstream(cam: Cam): Promise<Buffer> {
  // The catalogue is built from third-party feeds, one of which is
  // scraped HTML — so these URLs are externally controlled and get the
  // same SSRF check every other outbound fetch in this codebase uses.
  if (!(await isUrlSafeToFetch(cam.stillUrl))) {
    throw new Error(`refusing to fetch unsafe URL for ${cam.id}`);
  }

  const response = await fetch(cam.stillUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${cam.id} upstream responded ${response.status}`);

  const declared = response.headers.get("content-type") ?? "";
  // Some feeds answer a dead camera with an HTML error page and a 200.
  if (declared && !declared.startsWith("image/")) {
    throw new Error(`${cam.id} upstream returned ${declared}, not an image`);
  }

  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_UPSTREAM_BYTES) {
    throw new Error(`${cam.id} upstream frame is ${length} bytes`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error(`${cam.id} upstream returned an empty body`);
  if (buffer.byteLength > MAX_UPSTREAM_BYTES) throw new Error(`${cam.id} upstream frame too large`);
  return buffer;
}

/**
 * True for the flat, bright "unavailable" cards described above. Errs
 * heavily toward keeping a frame: an image sharp can't analyse is treated
 * as real rather than thrown away on a failed measurement.
 */
async function isPlaceholderCard(original: Buffer): Promise<boolean> {
  try {
    const stats = await sharp(original, { failOn: "none" }).stats();
    const mean = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / stats.channels.length;
    return mean >= PLACEHOLDER_MIN_MEAN && stats.entropy < PLACEHOLDER_MAX_ENTROPY;
  } catch {
    return false;
  }
}

async function loadFrame(cam: Cam, thumbnail: boolean): Promise<CachedFrame> {
  const original = await fetchUpstream(cam);

  if (await isPlaceholderCard(original)) {
    // Treated exactly like an unreachable camera: the map hides the tile
    // and the detail panel says the camera isn't responding, which is the
    // truth the placeholder was trying to convey anyway.
    throw new Error(`${cam.id} returned an "unavailable" placeholder image`);
  }

  if (!thumbnail) {
    // Full size is for the detail view, where the point is to see the
    // actual picture — re-encoding it would only cost quality.
    return { body: original, contentType: "image/jpeg", fetchedAt: Date.now() };
  }

  // `withoutEnlargement` keeps an already-small frame from being upscaled
  // into a blurry mess, and rotate() applies any EXIF orientation before
  // the metadata is dropped.
  const resized = await sharp(original, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  return { body: resized, contentType: "image/webp", fetchedAt: Date.now() };
}

/**
 * Returns a camera's current frame, downscaled unless `thumbnail` is
 * false. Only thumbnails are cached — a full-size frame is viewed once,
 * by one person, and caching it would evict hundreds of thumbnails to do
 * it.
 */
export async function getFrame(cam: Cam, thumbnail = true): Promise<CachedFrame> {
  const key = `${cam.id}|${thumbnail ? "t" : "f"}`;

  if (thumbnail) {
    const hit = readCache(key);
    if (hit) return hit;
  }

  if (isFailing(key)) throw new Error(`${cam.id} is in the failure back-off window`);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const frame = await loadFrame(cam, thumbnail);
      if (thumbnail) writeCache(key, frame, Math.max(MIN_TTL_SECONDS, cam.refreshSeconds));
      failures.delete(key);
      return frame;
    } catch (error) {
      failures.set(key, Date.now() + FAILURE_TTL_SECONDS * 1000);
      // Bounded so a long-lived process can't accumulate an entry per
      // camera in the whole catalogue.
      if (failures.size > 5000) failures.clear();
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/** How long a client may reuse a frame — mirrors the server-side TTL. */
export function browserTtlSeconds(cam: Cam): number {
  return Math.max(MIN_TTL_SECONDS, cam.refreshSeconds);
}

/**
 * Whether this camera's thumbnail failed recently.
 *
 * The viewport query uses this to skip cameras that are currently down.
 * That matters more than it sounds: thinning awards one slot per patch of
 * screen, so a dead camera doesn't merely fail to draw — it blocks a
 * working neighbour from taking the slot, leaving a visible hole. The
 * back-off window expires on its own, so a camera that comes back is
 * retried and returns to the map without anything needing to be reset.
 */
export function isKnownUnavailable(camId: string): boolean {
  return isFailing(`${camId}|t`);
}
