import type { Cam, CamSource } from "./types";
import { caltransSource } from "./sources/caltrans";
import { oneStop511Source } from "./sources/onestop511";
import { tflSource } from "./sources/tfl";
import { avoSource } from "./sources/avo";
import { windySource } from "./sources/windy";
import { digitrafficSource } from "./sources/digitraffic";
import { nztaSource } from "./sources/nzta";
import { singaporeSource } from "./sources/singapore";
import { curatedSource, PROMOTIONS } from "./sources/curated";

/**
 * The merged camera catalogue, held in memory for the life of the server
 * process.
 *
 * Sources are refreshed independently and on their own clocks, because
 * they go stale at wildly different rates: Caltrans and the 511 sites
 * publish a *stable* image URL that always points at the newest frame, so
 * their roster only needs re-reading a couple of times a day, while AVO
 * bakes the capture timestamp into the URL — a two-hour-old AVO entry
 * points at a two-hour-old picture, which defeats the entire "you can
 * tell what time of day it is" idea.
 *
 * Everything here is stale-while-revalidate: once a source has loaded
 * once, callers always get an answer immediately and a stale source
 * refreshes in the background. Only the very first call for a given
 * source ever waits.
 */

interface RegisteredSource {
  source: CamSource;
  /** How long this source's data stays usable before a background refresh is kicked off. */
  ttlMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const SOURCES: RegisteredSource[] = [
  { source: curatedSource, ttlMs: 12 * HOUR },
  { source: avoSource, ttlMs: 15 * MINUTE },
  { source: caltransSource, ttlMs: 6 * HOUR },
  { source: oneStop511Source, ttlMs: 6 * HOUR },
  { source: tflSource, ttlMs: 6 * HOUR },
  { source: digitrafficSource, ttlMs: 6 * HOUR },
  { source: nztaSource, ttlMs: 6 * HOUR },
  // Singapore republishes every frame under a fresh UUID, so a stale
  // roster points at frames that no longer exist — same failure mode as
  // AVO, and the same short TTL.
  { source: singaporeSource, ttlMs: 10 * MINUTE },
  { source: windySource, ttlMs: 6 * HOUR },
];

interface SourceState {
  cams: Cam[];
  fetchedAt: number;
  /** Held while a fetch is in flight so concurrent callers share one request. */
  inFlight: Promise<void> | null;
  lastError: string | null;
}

/**
 * Pinned to globalThis rather than being a plain module-level Map.
 *
 * Next bundles `instrumentation.ts` separately from the route handlers,
 * so a module-scoped Map gives the boot-time warm-up its *own* copy of
 * this state — it would dutifully fetch all 25,000 cameras into an
 * instance nothing ever reads, and the first real request would still pay
 * the full 40 seconds. Verified: the warm-up logged 25,622 cameras while
 * /api/health, running in the request bundle, still reported zero.
 *
 * Hanging it off globalThis is the standard Next escape hatch for a
 * process-wide singleton (the same reason database clients are stored
 * this way) and additionally survives dev-mode hot reloads.
 */
const globalForCams = globalThis as typeof globalThis & {
  __wevSourceState?: Map<string, SourceState>;
};

const state: Map<string, SourceState> = (globalForCams.__wevSourceState ??= new Map<string, SourceState>());

function stateFor(key: string): SourceState {
  let existing = state.get(key);
  if (!existing) {
    existing = { cams: [], fetchedAt: 0, inFlight: null, lastError: null };
    state.set(key, existing);
  }
  return existing;
}

function refresh(entry: RegisteredSource): Promise<void> {
  const current = stateFor(entry.source.key);
  if (current.inFlight) return current.inFlight;

  const run = (async () => {
    const startedAt = Date.now();
    try {
      const cams = await entry.source.fetchCams();
      // An empty result from a source that normally returns thousands is
      // almost always an upstream hiccup rather than a genuine emptying.
      // Keeping the previous roster means one bad refresh doesn't blank a
      // whole region of the map.
      if (cams.length === 0 && current.cams.length > 0) {
        current.lastError = "returned no cameras; keeping previous roster";
        console.warn(`[cams] ${entry.source.key} ${current.lastError}`);
      } else {
        current.cams = cams;
        current.lastError = null;
      }
      current.fetchedAt = Date.now();
      console.log(
        `[cams] ${entry.source.key}: ${current.cams.length} cameras in ${Date.now() - startedAt}ms`
      );
    } catch (error) {
      current.lastError = error instanceof Error ? error.message : String(error);
      // Back off from a hard-failing source rather than retrying it on
      // every single request.
      current.fetchedAt = Date.now();
      console.warn(`[cams] ${entry.source.key} failed:`, error);
    } finally {
      current.inFlight = null;
    }
  })();

  current.inFlight = run;
  return run;
}

export interface Catalog {
  cams: Cam[];
  byId: Map<string, Cam>;
  /** Per-source health, surfaced on the page so a dead feed is visible rather than silent. */
  sources: { key: string; label: string; count: number; fetchedAt: number; error: string | null }[];
}

/**
 * Returns the merged catalogue, loading any source that has never been
 * fetched and kicking off (but not waiting on) a refresh for any source
 * that has gone stale.
 */
export async function getCatalog(): Promise<Catalog> {
  const now = Date.now();

  const coldLoads: Promise<void>[] = [];
  for (const entry of SOURCES) {
    const current = stateFor(entry.source.key);
    const isStale = now - current.fetchedAt > entry.ttlMs;
    if (!isStale) continue;

    const promise = refresh(entry);
    // Never loaded: we have nothing to show, so this one is worth waiting
    // for. Merely stale: serve what we have and let it catch up.
    if (current.fetchedAt === 0) coldLoads.push(promise);
  }

  if (coldLoads.length > 0) await Promise.allSettled(coldLoads);

  const cams: Cam[] = [];
  const byId = new Map<string, Cam>();
  const sources: Catalog["sources"] = [];

  for (const entry of SOURCES) {
    const current = stateFor(entry.source.key);
    sources.push({
      key: entry.source.key,
      label: entry.source.label,
      count: current.cams.length,
      fetchedAt: current.fetchedAt,
      error: current.lastError,
    });
    for (const cam of current.cams) {
      // First source wins on an id collision. Ordering in SOURCES is
      // therefore meaningful: curated entries deliberately sit first so a
      // hand-written override beats the same camera arriving from a feed.
      if (byId.has(cam.id)) continue;

      // A promoted camera keeps its feed's live image URL and coordinates
      // — only the labelling and ranking are hand-written, so a promotion
      // can never point the map at a stale or wrong picture.
      const promotion = PROMOTIONS[cam.id];
      const resolved = promotion ? { ...cam, ...promotion } : cam;

      byId.set(resolved.id, resolved);
      cams.push(resolved);
    }
  }

  return { cams, byId, sources };
}

/** Resolving an id through the catalogue is what stops the thumbnail proxy being an open image proxy. */
export async function getCamById(id: string): Promise<Cam | null> {
  const catalog = await getCatalog();
  return catalog.byId.get(id) ?? null;
}

export interface CatalogSnapshot {
  /** True once at least one source has loaded — i.e. the map has something to draw. */
  warm: boolean;
  count: number;
  sources: { key: string; count: number; fetchedAt: number; error: string | null }[];
}

/**
 * Reports current state without triggering a load.
 *
 * The health endpoint needs this: calling getCatalog() there would start
 * a ~40-second fetch on a cold process and hang the very check that's
 * supposed to prove the process is alive.
 */
export function peekCatalog(): CatalogSnapshot {
  let count = 0;
  const sources = SOURCES.map((entry) => {
    const current = stateFor(entry.source.key);
    count += current.cams.length;
    return {
      key: entry.source.key,
      count: current.cams.length,
      fetchedAt: current.fetchedAt,
      error: current.lastError,
    };
  });

  return { warm: count > 0, count, sources };
}
