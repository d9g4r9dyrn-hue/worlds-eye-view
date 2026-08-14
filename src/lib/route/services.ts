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

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached) return cached;

  return schedule(async () => {
    // Re-check: an identical query may have resolved while queued.
    const raced = cache.get(key);
    if (raced) return raced;

    const url = new URL(NOMINATIM);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);

    const results = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const first = results[0];
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
