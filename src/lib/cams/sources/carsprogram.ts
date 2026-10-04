import type { Cam, CamSource } from "../types";

/**
 * Traveler-information sites built on the Castle Rock "CARS" platform:
 * New York, Colorado, Minnesota, Iowa, Kansas, Nebraska, Indiana and
 * Massachusetts, about 7,400 cameras between them.
 *
 * This is the second big 511 vendor after the one in onestop511.ts, and
 * it exists as its own adapter because of New York. 511ny.org used to
 * answer `/List/GetData/Cameras`; in 2026 it moved to this platform and
 * that path now returns the single-page app's HTML shell with a 200, so
 * the old adapter threw "returned HTML, not JSON" on every refresh and
 * the whole state silently vanished from the map.
 *
 * Every site here answers the same key-free endpoint, which is the one
 * each public map reads its own camera layer from:
 *
 *   https://<prefix>tg.carsprogram.org/cameras_v1/api/cameras
 *
 * It returns a flat JSON array with coordinates and one or more views
 * per camera. A view is either a still (`STILL_IMAGE`, the frame is
 * `url`) or a video stream (`WMP` is HLS, `MJPEG` is a paid third-party
 * stream), and video views carry a `videoPreviewUrl` that is an ordinary
 * JPEG or PNG refreshed every few minutes. The app has no video path, so
 * the preview is what gets used, and a view with neither is skipped. The
 * `url` of a video view is never used: Massachusetts embeds a
 * third-party stream key in it.
 *
 * Measured when this was written: NY 2,717, MN 1,528, CO 1,032, IA 861,
 * IN 749, KS 608, NE 348, MA 308 (about 166 after the stale-frame check
 * described on `dropStaleFrames`). Idaho, Louisiana and northern New
 * England are sometimes described as Castle Rock states but have no
 * `<prefix>tg` host; they run the other vendor and are in onestop511.ts.
 */

interface CarsSite {
  key: string;
  /** Host prefix: `<prefix>tg.carsprogram.org`. */
  prefix: string;
  label: string;
  region: string;
  /** The public map, used as the attribution link. */
  sourcePage: string;
  /** Loose envelope that catches broken coordinates; see onestop511.ts for the reasoning. */
  bounds: { south: number; west: number; north: number; east: number };
  /**
   * Check every frame's Last-Modified while building the roster and drop
   * the ones that have stopped updating.
   *
   * Only Massachusetts needs it. When a stream is down the platform keeps
   * serving the last preview it made, which for a dead Massachusetts
   * camera is a dark blue "This image is temporarily unavailable" card.
   * The thumbnail proxy's placeholder test only rejects bright, flat
   * cards, so these would be drawn as if they were cameras. Measured:
   * 142 of 308 Massachusetts previews were that card, every one more
   * than an hour old, against 2 to 6 percent stale in the other states,
   * where 2,700 extra requests per refresh would not be worth it.
   */
  dropStaleFrames?: boolean;
}

/** A preview older than this is a stream that is down, not a slow camera. */
const STALE_FRAME_MS = 60 * 60_000;

/** Parallel HEAD requests for the staleness check. */
const STALE_CHECK_CONCURRENCY = 16;

const SITES: CarsSite[] = [
  {
    key: "ny",
    prefix: "nysdot",
    label: "NYSDOT",
    region: "New York",
    sourcePage: "https://511ny.org/",
    bounds: { south: 37, west: -84, north: 47, east: -68 },
  },
  {
    key: "co",
    prefix: "co",
    label: "Colorado DOT",
    region: "Colorado",
    sourcePage: "https://www.cotrip.org/",
    bounds: { south: 34, west: -112, north: 44, east: -99 },
  },
  {
    key: "mn",
    prefix: "mn",
    label: "Minnesota DOT",
    region: "Minnesota",
    sourcePage: "https://511mn.org/",
    bounds: { south: 41, west: -100, north: 51, east: -87 },
  },
  {
    key: "ia",
    prefix: "ia",
    label: "Iowa DOT",
    region: "Iowa",
    sourcePage: "https://511ia.org/",
    bounds: { south: 38, west: -99, north: 46, east: -88 },
  },
  {
    key: "ks",
    prefix: "ks",
    label: "Kansas DOT",
    region: "Kansas",
    sourcePage: "https://www.kandrive.gov/",
    bounds: { south: 34.5, west: -104.5, north: 42.5, east: -92 },
  },
  {
    key: "ne",
    prefix: "ne",
    label: "Nebraska DOT",
    region: "Nebraska",
    sourcePage: "https://511.nebraska.gov/",
    bounds: { south: 37.5, west: -106.5, north: 45.5, east: -93 },
  },
  {
    key: "in",
    prefix: "in",
    label: "Indiana DOT",
    region: "Indiana",
    sourcePage: "https://511in.org/",
    bounds: { south: 35.5, west: -90.5, north: 44, east: -82.5 },
  },
  {
    key: "ma",
    prefix: "ma",
    label: "MassDOT",
    region: "Massachusetts",
    sourcePage: "https://mass511.com/",
    bounds: { south: 39.5, west: -75.5, north: 44.5, east: -68 },
    dropStaleFrames: true,
  },
];

interface CarsView {
  type?: string;
  url?: string;
  videoPreviewUrl?: string;
  broken?: boolean;
}

interface CarsCamera {
  id?: number | string;
  public?: boolean;
  name?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    routeId?: string;
    cityReference?: string;
  };
  views?: CarsView[];
}

/** The frame for a view, or null when the view is video with no preview. */
function stillFor(view: CarsView): string | null {
  if (view.broken) return null;
  const url = view.type === "STILL_IMAGE" ? view.url : view.videoPreviewUrl;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** `cityReference` reads "in Sioux City" or "3 miles south of the Cortland area"; only the first form is a place name. */
function placeFrom(cityReference: string | undefined): string | null {
  const match = /^in\s+(.+)$/i.exec(cityReference?.trim() ?? "");
  return match ? match[1] : null;
}

/**
 * True when the frame's Last-Modified says it stopped updating. Anything
 * that cannot be measured (an error, a missing header) counts as live:
 * the proxy already copes with a dead frame, so the only job here is
 * removing frames that are positively known to be stale.
 */
async function isStale(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const modified = Date.parse(response.headers.get("last-modified") ?? "");
    return Number.isFinite(modified) && Date.now() - modified > STALE_FRAME_MS;
  } catch {
    return false;
  }
}

async function withoutStaleFrames(cams: Cam[]): Promise<Cam[]> {
  const stale = new Array<boolean>(cams.length).fill(false);
  let next = 0;
  async function worker() {
    while (next < cams.length) {
      const index = next++;
      stale[index] = await isStale(cams[index].stillUrl);
    }
  }
  await Promise.all(Array.from({ length: STALE_CHECK_CONCURRENCY }, worker));
  return cams.filter((_, index) => !stale[index]);
}

async function fetchSite(site: CarsSite): Promise<Cam[]> {
  const host = `${site.prefix}tg.carsprogram.org`;
  const response = await fetch(`https://${host}/cameras_v1/api/cameras`, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(40_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${host} responded ${response.status}`);

  // The 511 front ends answer unknown paths with their HTML shell and a
  // 200, which is exactly how New York went missing. Check the body.
  const text = await response.text();
  if (!text.trimStart().startsWith("[")) throw new Error(`${host} did not return a JSON array`);

  const rows = JSON.parse(text) as CarsCamera[];
  const cams: Cam[] = [];
  let outOfBounds = 0;

  for (const row of rows) {
    if (row.id == null || row.public === false) continue;

    const lat = row.location?.latitude;
    const lon = row.location?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const { south, west, north, east } = site.bounds;
    if (lat < south || lat > north || lon < west || lon > east) {
      outOfBounds++;
      continue;
    }

    // Several views share one mast; the first usable one becomes the pin.
    let stillUrl: string | null = null;
    for (const view of row.views ?? []) {
      stillUrl = stillFor(view);
      if (stillUrl) break;
    }
    if (!stillUrl) continue;

    cams.push({
      id: `cars${site.key}:${row.id}`,
      title: row.name?.trim() || `${site.region} camera ${row.id}`,
      place: placeFrom(row.location?.cityReference) ?? row.location?.routeId?.trim() ?? site.region,
      country: "United States",
      lat,
      lon,
      category: "traffic",
      // Thousands of them, so they fill in as you zoom rather than
      // competing at continental scale. Same value as the other 511 feeds.
      prominence: 2,
      stillUrl,
      // Stills and stream previews are both regenerated every few minutes;
      // the feed states no rate, and five minutes matched the Last-Modified
      // headers sampled on previews in New York and Minnesota.
      refreshSeconds: 300,
      sourcePage: site.sourcePage,
      provider: site.label,
    });
  }

  if (outOfBounds > 0) {
    console.warn(`[cams] ${host}: dropped ${outOfBounds} camera(s) with coordinates outside ${site.region}`);
  }

  return site.dropStaleFrames ? withoutStaleFrames(cams) : cams;
}

export const carsProgramSource: CamSource = {
  key: "cars",
  label: "State 511 traffic cameras (CARS platform)",
  async fetchCams() {
    const settled = await Promise.allSettled(SITES.map(fetchSite));
    const cams: Cam[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") cams.push(...result.value);
      else console.warn(`[cams] cars ${SITES[index].prefix} failed:`, result.reason);
    }
    return cams;
  },
};
