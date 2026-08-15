import type { LatLon } from "./corridor";

/**
 * Geocoding and routing, both from free OpenStreetMap-based services.
 *
 * Deliberately server-side only. Two reasons, and the first is the
 * important one:
 *
 * 1. **Nominatim's usage policy.** It's a donated service with an
 *    absolute maximum of one request per second and a requirement to
 *    identify your application honestly. Calling it from the browser
 *    would mean one request per visitor with no way to throttle, which is
 *    exactly the abuse the policy exists to prevent. Here it's rate
 *    limited and cached in one place.
 * 2. The CSP keeps `connect-src` at `'self'`, so the page can't reach
 *    these hosts anyway.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Honest identification, as Nominatim's policy requires. */
const USER_AGENT = "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)";

/** Nominatim's stated ceiling is 1 req/s; leave headroom. */
const MIN_GEOCODE_GAP_MS = 1_200;

const globalForRoute = globalThis as typeof globalThis & {
  __wevGeocodeCache?: Map<string, GeocodeResult>;
  __wevGeocodeGate?: { last: number; chain: Promise<unknown> };
};

const cache: Map<string, GeocodeResult> = (globalForRoute.__wevGeocodeCache ??= new Map());
const gate = (globalForRoute.__wevGeocodeGate ??= { last: 0, chain: Promise.resolve() });

export interface GeocodeResult extends LatLon {
  label: string;
}

/**
 * Serialises geocode calls and spaces them out.
 *
 * Requests queue on a shared promise chain rather than racing, so two
 * users searching at once produce two spaced requests instead of two
 * simultaneous ones.
 */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = gate.chain.then(async () => {
    const wait = Math.max(0, gate.last + MIN_GEOCODE_GAP_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    gate.last = Date.now();
    return task();
  });

  // Keep the chain alive even when a link rejects, or one failure would
  // wedge every later request.
  gate.chain = run.catch(() => undefined);
  return run;
}

/**
 * Common abbreviations, spelled out.
 *
 * Nominatim matches against OpenStreetMap's own street names, which are
 * written out in full ("North Highway 19", not "N Hwy 19"). It does
 * understand a few abbreviations, but not the ones people actually type:
 * "19135 us hw 19 n" finds nothing while the same address written out
 * resolves immediately. Expanding these before the query costs nothing
 * and turns a dead end into a hit.
 *
 * Applied whole-word only, so "Stockholm" is not mangled into
 * "Streetockholm" and a street genuinely called "Ave Maria" survives.
 *
 * Deliberately absent: "st" and "co".
 *
 * Both are genuinely ambiguous, and because the expanded spelling is
 * tried first, guessing wrong doesn't merely fail — it returns the wrong
 * place confidently. "St" is Saint at least as often as Street (St
 * Petersburg, St Louis, St Paul), and expanding it turned a search for
 * the Florida city into "Saint Petersburg Street" in Clay County, 200km
 * away. "Co" is Colorado as readily as County. Nominatim handles both
 * unexpanded perfectly well; the entries here are only for abbreviations
 * it genuinely does not know, which is what "hw" was.
 */
const ABBREVIATIONS: Record<string, string> = {
  hw: "highway", hwy: "highway", hway: "highway",
  str: "street", rd: "road", dr: "drive", ln: "lane",
  ave: "avenue", av: "avenue", blvd: "boulevard", blv: "boulevard",
  ct: "court", cir: "circle", pl: "place", pkwy: "parkway", pky: "parkway",
  ter: "terrace", trl: "trail", sq: "square", plz: "plaza",
  n: "north", s: "south", e: "east", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
  ft: "fort", mt: "mount", pt: "point",
};

function expandAbbreviations(query: string): string {
  // Replaces runs of letters only, so digits, spaces and punctuation
  // pass through untouched and "19135" stays a house number rather
  // than a candidate for expansion.
  return query.replace(/[A-Za-z]+/g, (word) => ABBREVIATIONS[word.toLowerCase()] ?? word);
}

/**
 * Progressively looser attempts at one query.
 *
 * Ordered most faithful first, so an exact match is never passed over in
 * favour of a vaguer one. Each later variant gives up a piece of detail
 * that commonly prevents a match rather than enabling one - the trailing
 * direction, then the house number, which pins the result to a building
 * that may simply not be mapped even though the street is.
 *
 * Duplicates are dropped so a query needing no expansion still costs a
 * single request.
 */
function variants(query: string): string[] {
  const trimmed = query.trim();
  const expanded = expandAbbreviations(trimmed);
  const withoutDirection = expanded.replace(/\s+(north|south|east|west|northeast|northwest|southeast|southwest)$/i, "");
  const withoutNumber = withoutDirection.replace(/^\s*\d+\s+/, "");

  /*
   * Expanded FIRST, not the raw string.
   *
   * This ordering is load-bearing and the opposite of the obvious one.
   * Nominatim will happily match an abbreviation against something it
   * should not: "19135 us hw 19 n" returns "Poachers Hw" in Ohio, which
   * is a hit, so a raw-first order stops there and never tries the
   * expansion that finds the actual address in Clearwater. Returning
   * the wrong place confidently is worse than returning nothing, so the
   * normalised spelling gets first refusal and the raw string is the
   * fallback for names that genuinely contain a short word.
   */
  return [...new Set([expanded, trimmed, withoutDirection, withoutNumber])].filter((value) => value.length > 0);
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached) return cached;

  return schedule(async () => {
    // Re-check: an identical query may have resolved while queued.
    const raced = cache.get(key);
    if (raced) return raced;

    let first: { lat?: string; lon?: string; display_name?: string } | undefined;

    // Tried in order, stopping at the first hit. Every attempt is inside
    // the same scheduled slot, so a query that needs three of them still
    // respects the one-request-per-second courtesy limit rather than
    // firing a burst.
    for (const attempt of variants(query)) {
      const url = new URL(NOMINATIM);
      url.searchParams.set("q", attempt);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");

      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);

      const results = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
      if (results[0]?.lat && results[0]?.lon) {
        first = results[0];
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    }

    if (!first?.lat || !first?.lon) return null;

    const result: GeocodeResult = {
      lat: Number(first.lat),
      lon: Number(first.lon),
      label: first.display_name ?? query,
    };

    // Place names don't move; an unbounded cache is the only real risk.
    if (cache.size > 2_000) cache.clear();
    cache.set(key, result);
    return result;
  });
}

export interface RoutePath {
  path: LatLon[];
  distanceMeters: number;
  durationSeconds: number;
}

export async function routeBetween(from: LatLon, to: LatLon): Promise<RoutePath | null> {
  // OSRM takes lon,lat — the reverse of almost everything else here, and
  // a silent source of routes through the wrong hemisphere.
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = new URL(`${OSRM}/${coords}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Router responded ${response.status}`);

  const payload = (await response.json()) as {
    code?: string;
    routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[];
  };

  if (payload.code !== "Ok" || !payload.routes?.length) return null;

  const route = payload.routes[0];
  const coordinates = route.geometry?.coordinates ?? [];
  if (coordinates.length < 2) return null;

  return {
    path: coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
  };
}
