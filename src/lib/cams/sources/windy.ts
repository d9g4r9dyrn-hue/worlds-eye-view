import type { Cam, CamCategory, CamSource } from "../types";

/**
 * Windy Webcams API — the only source here with genuinely global reach,
 * and the only one that carries the categories this map is short of
 * (observatories, harbours, mountains, wildlife) rather than yet more
 * highways.
 *
 * Requires WINDY_API_KEY. Without it this returns nothing and the map
 * falls back to the key-free sources, which is why the feature works out
 * of the box and simply gets wider once a key is set.
 *
 * ## Built around the free tier's two real limits
 *
 * **Image URLs expire after 10 minutes.** Far sooner than any sensible
 * roster refresh, so the roster deliberately does *not* trust the URL it
 * saw at fetch time. It keeps only the durable metadata — coordinates,
 * title, category — and mints a fresh URL per camera at the moment
 * somebody actually looks at one (see `resolveStillUrl`). The alternative,
 * re-reading the entire catalogue every few minutes purely to keep links
 * alive, would burn hundreds of calls an hour for cameras nobody opened.
 *
 * **Offset is capped at 1,000 webcams** — but *per query*, not per key.
 * That distinction is the whole design of this file. A single unfiltered
 * paging run reaches ~1,050 of Windy's 70,000 cameras, and because the
 * default ordering is by view count that slice is overwhelmingly
 * European: measured, it came back as 278 cameras in Italy, 139 in
 * France, and **8 in the United States, out of 33,725 available there.**
 *
 * Filtered queries each get their own offset budget (`offset=1000` with
 * `countries=US` returns data; `offset=2000` is refused as "over API tier
 * limit"). So instead of one global run this fans out — a pass per
 * country, plus `nearby` anchors inside countries too large for one query
 * to cover evenly — and every camera still costs the same key.
 *
 * Because the reachable slice is small and arbitrary, these are given a
 * higher prominence than the traffic feeds — cameras spread over entire
 * continents should win their thumbnail slots, since outside North
 * America they are often the only thing there at all.
 */

const ENDPOINT = "https://api.windy.com/webcams/api/v3/webcams";

/** Windy's own per-request ceiling. */
const PAGE_SIZE = 50;

/**
 * The free tier's per-query offset ceiling, established by probing rather
 * than from the docs: `offset=1000` returns a full page, `offset=2000`
 * returns 400 "Offset is over API tier limit 1000!". So any one query can
 * reach offsets 0-1049.
 */
const MAX_OFFSET = 1_050;

/**
 * Requests per roster refresh.
 *
 * The refresh runs once a day (see registry.ts), so this is also roughly
 * the daily cost of keeping the roster current — and it shares the key's
 * quota with the per-view URL minting in `resolveStillUrl`, which is the
 * part that scales with actual visitors and therefore matters more.
 *
 * Windy publishes no quota headers on the free tier (checked — the
 * response carries none), so this is a deliberately conservative guess
 * rather than a number tuned to a documented ceiling. Raise it via the
 * environment if the plan turns out to have room: at 200 requests the
 * fan-out returns roughly 7,000 cameras and is still budget-limited, so
 * there is more to be had.
 */
const MAX_REQUESTS = Number(process.env.WINDY_MAX_REQUESTS) || 200;

/** Cameras to take from the unfiltered, view-count-ordered listing. */
const GLOBAL_TARGET = 250;

/**
 * Per-country targets.
 *
 * Deliberately flat-ish rather than proportional to what Windy holds:
 * proportional allocation would hand Italy and Austria most of the budget
 * all over again, which is the exact skew this exists to undo. A country
 * with 33,000 cameras and a country with 150 both contribute usefully to
 * a map whose problem is empty regions, so the small ones are worth as
 * much per camera as the large ones. Countries listed with a bigger
 * number are the ones large enough that a few hundred cameras still
 * leaves visible gaps.
 *
 * Countries already well covered by a dedicated free feed (Finland, New
 * Zealand, Hong Kong, Singapore) are still here: those feeds are traffic
 * cameras, and Windy is where the harbours, mountains and wildlife are.
 */
const COUNTRY_TARGETS: Record<string, number> = {
  // Americas
  US: 400, CA: 250, MX: 150, BR: 150, AR: 100, CL: 100, PE: 60, CO: 60, CR: 60,
  // Europe
  GB: 200, IE: 60, IS: 150, NO: 150, SE: 150, FI: 100, DK: 100, DE: 200,
  FR: 200, IT: 200, ES: 200, PT: 150, CH: 150, AT: 150, NL: 100, BE: 60,
  PL: 100, CZ: 100, HR: 100, GR: 150, TR: 100, RO: 60,
  // Africa & Middle East
  ZA: 100, KE: 60, TZ: 60, NA: 60, MA: 60, EG: 60, AE: 60, IL: 60,
  // Asia
  JP: 200, KR: 100, TW: 60, CN: 60, TH: 100, VN: 60, MY: 60, ID: 150,
  PH: 60, IN: 100, NP: 60, LK: 60,
  // Oceania
  AU: 250, NZ: 200, FJ: 60,
};

/**
 * Anchors for spreading *within* a country too big for one query.
 *
 * `countries=US` orders by view count like everything else, so its first
 * few hundred results cluster in whichever handful of places happen to be
 * popular. A `nearby` query re-runs that ranking against one region at a
 * time, which is the only lever the free tier offers for reaching the
 * quiet parts of a large country.
 *
 * Radius is in kilometres and **must not exceed 250** — anything larger
 * is refused with "Radius should be in range (0 < radius <= 250)!". That
 * ceiling is why this is a list of twenty anchors rather than a handful
 * of big circles.
 */
const MAX_NEARBY_RADIUS_KM = 250;

const REGIONAL_ANCHORS: { label: string; lat: number; lon: number; radiusKm: number; target: number }[] = [
  { label: "US Cascades", lat: 47.5, lon: -121.5, radiusKm: 250, target: 80 },
  { label: "US Oregon", lat: 44.0, lon: -121.5, radiusKm: 250, target: 80 },
  { label: "US Sierra Nevada", lat: 38.5, lon: -120.0, radiusKm: 250, target: 80 },
  { label: "US Southern California", lat: 34.0, lon: -117.0, radiusKm: 250, target: 80 },
  { label: "US Arizona", lat: 34.5, lon: -111.5, radiusKm: 250, target: 80 },
  { label: "US Utah", lat: 39.5, lon: -111.0, radiusKm: 250, target: 80 },
  { label: "US Colorado", lat: 39.5, lon: -106.0, radiusKm: 250, target: 80 },
  { label: "US Montana", lat: 45.7, lon: -110.5, radiusKm: 250, target: 80 },
  { label: "US New Mexico", lat: 35.0, lon: -106.0, radiusKm: 250, target: 80 },
  { label: "US Texas", lat: 31.0, lon: -98.0, radiusKm: 250, target: 80 },
  { label: "US Great Plains", lat: 41.0, lon: -100.0, radiusKm: 250, target: 80 },
  { label: "US Upper Midwest", lat: 45.5, lon: -93.0, radiusKm: 250, target: 80 },
  { label: "US Michigan", lat: 44.5, lon: -85.0, radiusKm: 250, target: 80 },
  { label: "US New England", lat: 43.5, lon: -72.0, radiusKm: 250, target: 80 },
  { label: "US Mid-Atlantic", lat: 39.0, lon: -77.5, radiusKm: 250, target: 80 },
  { label: "US Southeast", lat: 33.5, lon: -84.0, radiusKm: 250, target: 80 },
  { label: "US Florida", lat: 27.5, lon: -81.5, radiusKm: 250, target: 80 },
  { label: "US Gulf Coast", lat: 30.0, lon: -92.0, radiusKm: 250, target: 80 },
  { label: "US Alaska", lat: 61.2, lon: -149.9, radiusKm: 250, target: 80 },
  { label: "US Hawaii", lat: 20.7, lon: -156.3, radiusKm: 250, target: 60 },
];

/** How long a minted image URL is treated as usable. Windy's free tier expires them at 10 minutes. */
export const WINDY_URL_TTL_SECONDS = 480;

interface WindyWebcam {
  webcamId?: number;
  title?: string;
  status?: string;
  viewCount?: number;
  categories?: { id?: string; name?: string }[];
  images?: { current?: { preview?: string; thumbnail?: string; icon?: string } };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  urls?: { detail?: string };
}

/** Windy's category vocabulary is much finer than ours; fold it down. */
const CATEGORY_MAP: Record<string, CamCategory> = {
  traffic: "traffic",
  airport: "airport",
  harbor: "harbor",
  harbour: "harbor",
  beach: "harbor",
  mountain: "mountain",
  ski: "mountain",
  volcano: "volcano",
  observatory: "observatory",
  meteo: "weather",
  weather: "weather",
  city: "city",
  square: "city",
  building: "city",
  park: "wildlife",
  nature: "wildlife",
  animals: "wildlife",
  zoo: "wildlife",
};

function categoryFor(webcam: WindyWebcam): CamCategory {
  for (const category of webcam.categories ?? []) {
    const mapped = category.id ? CATEGORY_MAP[category.id.toLowerCase()] : undefined;
    if (mapped) return mapped;
  }
  return "city";
}

/**
 * View count is a decent proxy for "is this one of the famous ones" — a
 * Times Square cam and a cam in someone's back garden are otherwise
 * indistinguishable in the payload. Mapped onto a 5-9 band: higher than
 * the traffic feeds because outside North America these are frequently
 * the only cameras on screen, but still below a hand-picked promotion.
 */
function prominenceFor(webcam: WindyWebcam): number {
  const views = webcam.viewCount ?? 0;
  if (views > 500_000) return 9;
  if (views > 100_000) return 8;
  if (views > 20_000) return 7;
  if (views > 5_000) return 6;
  return 5;
}

function apiKey(): string | null {
  return process.env.WINDY_API_KEY || null;
}

/** The site these calls are made on behalf of. See windyFetch. */
const SITE_ORIGIN = "https://cams.corticorp.com";

async function windyFetch(url: URL | string, key: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "x-windy-api-key": key,
      // Windy's optional key setting restricts a key to named domains,
      // and that check is normally made against Referer/Origin. These
      // calls are made server-side, where neither header exists by
      // default — so a domain-restricted key would reject them.
      //
      // Sending them explicitly means the restriction can be switched on
      // without breaking anything. It costs nothing when no restriction
      // is set, and it's honest: the request really is made on behalf of
      // this site.
      Referer: `${SITE_ORIGIN}/`,
      Origin: SITE_ORIGIN,
      "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
}

function pickImage(webcam: WindyWebcam): string | null {
  const images = webcam.images?.current;
  return images?.preview ?? images?.thumbnail ?? images?.icon ?? null;
}

/**
 * Fetches a single webcam purely to get a currently-valid image URL.
 *
 * Called from the thumbnail proxy, which caches the resulting frame for
 * this camera's refresh interval — so this is roughly one API call per
 * camera per interval, and only for cameras somebody opened, rather than
 * one per camera in the catalogue.
 */
async function resolveStillUrl(cam: Cam): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("WINDY_API_KEY is not set");

  const webcamId = cam.id.slice("windy:".length);
  const url = new URL(`${ENDPOINT}/${encodeURIComponent(webcamId)}`);
  url.searchParams.set("include", "images");

  const response = await windyFetch(url, key);
  if (!response.ok) throw new Error(`Windy webcam ${webcamId} responded ${response.status}`);

  const webcam = (await response.json()) as WindyWebcam;
  const image = pickImage(webcam);
  if (!image) throw new Error(`Windy webcam ${webcamId} returned no image`);
  return image;
}

async function fetchPage(
  key: string,
  offset: number,
  filter: Record<string, string> = {}
): Promise<WindyWebcam[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  // `images` is still requested so a camera with no imagery at all can be
  // skipped at roster time rather than failing later on every view.
  url.searchParams.set("include", "images,location,categories,urls");
  for (const [name, value] of Object.entries(filter)) url.searchParams.set(name, value);

  const response = await windyFetch(url, key);
  if (!response.ok) throw new Error(`Windy responded ${response.status}`);

  const payload = (await response.json()) as { webcams?: WindyWebcam[] };
  return payload.webcams ?? [];
}

function toCam(webcam: WindyWebcam): Cam | null {
  const location = webcam.location;
  if (!webcam.webcamId || !location) return null;
  if (webcam.status && webcam.status !== "active") return null;
  // No imagery now means no imagery later; skip rather than let it fail
  // on every view.
  const image = pickImage(webcam);
  if (!image) return null;

  const lat = location.latitude;
  const lon = location.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  return {
    id: `windy:${webcam.webcamId}`,
    title: webcam.title?.trim() || "Webcam",
    place: location.city?.trim() || location.region?.trim() || null,
    country: location.country?.trim() || null,
    lat,
    lon,
    category: categoryFor(webcam),
    prominence: prominenceFor(webcam),
    // Recorded for reference, but not relied on: it will have expired
    // long before most views. resolveStillUrl is what the proxy uses.
    stillUrl: image,
    resolveStillUrl,
    refreshSeconds: WINDY_URL_TTL_SECONDS,
    sourcePage: webcam.urls?.detail ?? null,
    provider: "Windy.com",
  };
}

export const windySource: CamSource = {
  key: "windy",
  label: "Windy Webcams",
  async fetchCams() {
    const key = apiKey();
    if (!key) return [];

    // Keyed by camera id: the passes overlap heavily by design — a famous
    // Colorado cam is in the global listing, in `countries=US`, and in the
    // Colorado anchor — and whichever pass sees it first wins.
    const cams = new Map<string, Cam>();
    let requests = 0;

    /**
     * Pages one filtered query until it has `target` cameras, the query
     * runs dry, or the shared request budget is gone.
     */
    async function collect(label: string, filter: Record<string, string>, target: number) {
      const before = cams.size;
      for (let offset = 0; offset < Math.min(MAX_OFFSET, target); offset += PAGE_SIZE) {
        if (requests >= MAX_REQUESTS) return;

        let batch: WindyWebcam[];
        try {
          requests++;
          batch = await fetchPage(key!, offset, filter);
        } catch (error) {
          // One bad pass shouldn't cost the other forty. Keep what's
          // collected and move on to the next query rather than aborting
          // the whole roster the way a single loop used to.
          console.warn(`[cams] Windy ${label} offset ${offset} failed:`, error);
          return;
        }

        for (const webcam of batch) {
          const cam = toCam(webcam);
          if (cam && !cams.has(cam.id)) cams.set(cam.id, cam);
        }

        if (batch.length < PAGE_SIZE) break;
      }
      return cams.size - before;
    }

    // Most-viewed worldwide first: these are the cameras people actually
    // want to look at, and they should not lose their slot to the long
    // tail just because the tail is more evenly spread.
    await collect("global", {}, GLOBAL_TARGET);

    // Cheapest countries first. If the budget runs out — and it does —
    // this decides what gets lost: depth in the countries that have
    // thousands of cameras, rather than the entire existence of the ones
    // that have thirty. The Philippines holds 3 cameras in all of Windy
    // and costs one request; letting it be crowded out by page 7 of the
    // United States would be exactly the wrong trade for a map whose
    // problem is empty regions.
    const byCost = Object.entries(COUNTRY_TARGETS).sort((a, b) => a[1] - b[1]);
    for (const [country, target] of byCost) {
      await collect(`countries=${country}`, { countries: country }, target);
    }

    for (const anchor of REGIONAL_ANCHORS) {
      const radius = Math.min(anchor.radiusKm, MAX_NEARBY_RADIUS_KM);
      await collect(
        anchor.label,
        { nearby: `${anchor.lat},${anchor.lon},${radius}` },
        anchor.target
      );
    }

    console.log(
      `[cams] Windy: ${cams.size} cameras from ${requests} requests` +
        (requests >= MAX_REQUESTS ? " (request budget exhausted — raise WINDY_MAX_REQUESTS for more)" : "")
    );

    return [...cams.values()];
  },
};
