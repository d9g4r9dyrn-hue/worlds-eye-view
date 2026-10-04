import type { Cam, CamSource } from "../types";

/**
 * 511 traveler-information sites, US states and Canadian provinces.
 *
 * A lot of them run the same vendor platform, which means one adapter
 * covers all of them: `/List/GetData/Cameras` returns the camera table as
 * JSON (no key, no registration) and `/map/Cctv/<imageId>` serves the
 * current frame. Adding another jurisdiction is one line in STATES below
 * — the only real work is confirming it actually answers, since a
 * handful of 511 sites run older or bespoke software that doesn't.
 *
 * Every entry here was checked against both endpoints before being
 * listed; the ones that returned HTML or 404 (Iowa, Minnesota, Rhode
 * Island, Nebraska, Wyoming and DriveBC among them) are deliberately
 * absent rather than left in to fail on every refresh.
 *
 * New York used to be here. 511ny.org moved to the Castle Rock platform
 * in 2026 and now answers this path with its app shell (HTML, status
 * 200), so it lives in carsprogram.ts with the other Castle Rock states.
 * A second sweep of about a hundred state and provincial hosts found
 * only Saskatchewan still to add; Virginia, South Carolina, New Jersey,
 * Ohio, Tennessee, Kansas, Oklahoma, Texas, Oregon, Washington, Quebec,
 * Montana, the Dakotas and South Africa's i-traffic.co.za all returned
 * HTML, 403 or 404 here.
 */

interface StateSite {
  key: string;
  host: string;
  label: string;
  region: string;
  country: string;
  /**
   * A very loose regional envelope, sized to catch coordinates that are
   * broken rather than merely near a border.
   *
   * The failure this exists for is real: NY camera 4822 and PA camera
   * 4358 are both published with a positive longitude — the minus sign
   * is missing — which lands two American traffic cameras in Central
   * Asia, glaringly visible on a world map. Errors of that kind are off
   * by a hundred degrees or more.
   *
   * So these boxes deliberately overshoot the jurisdiction by several
   * degrees in every direction. Most of these feeds legitimately carry
   * cameras from neighbouring states — Idaho publishes Oregon, Nevada
   * and Utah cameras on its border routes — and those are real cameras
   * that belong on the map. A tight box would silently throw them away.
   *
   * Dropping also beats "helpfully" flipping a bad sign: a coordinate
   * that wrong means the record can't be trusted, and a corrected guess
   * would put a camera somewhere nobody verified.
   */
  bounds: { south: number; west: number; north: number; east: number };
}

const STATES: StateSite[] = [
  {
    key: "ak",
    host: "511.alaska.gov",
    label: "Alaska DOT&PF",
    region: "Alaska",
    country: "United States",
    bounds: { south: 50, west: -180, north: 73, east: -127 },
  },
  {
    key: "pa",
    host: "511pa.com",
    label: "PennDOT",
    region: "Pennsylvania",
    country: "United States",
    bounds: { south: 36, west: -85, north: 45, east: -71 },
  },
  {
    key: "id",
    host: "511.idaho.gov",
    label: "Idaho Transportation Department",
    region: "Idaho",
    country: "United States",
    bounds: { south: 38, west: -122, north: 50, east: -107 },
  },
  {
    key: "wi",
    host: "511wi.gov",
    label: "Wisconsin DOT",
    region: "Wisconsin",
    country: "United States",
    bounds: { south: 40, west: -97, north: 49, east: -83 },
  },
  {
    key: "on",
    host: "511on.ca",
    label: "Ontario MTO",
    region: "Ontario",
    country: "Canada",
    bounds: { south: 38, west: -100, north: 58, east: -70 },
  },
  {
    key: "ab",
    host: "511.alberta.ca",
    label: "Alberta Transportation",
    region: "Alberta",
    country: "Canada",
    bounds: { south: 46, west: -125, north: 62, east: -105 },
  },
  {
    key: "sk",
    host: "hotline.gov.sk.ca",
    label: "Saskatchewan Highways",
    region: "Saskatchewan",
    country: "Canada",
    bounds: { south: 46, west: -113, north: 62, east: -98 },
  },
  {
    key: "yt",
    host: "511yukon.ca",
    label: "Yukon Highways",
    region: "Yukon",
    country: "Canada",
    bounds: { south: 57, west: -145, north: 72, east: -120 },
  },
  {
    key: "fl",
    host: "fl511.com",
    label: "Florida DOT",
    region: "Florida",
    country: "United States",
    bounds: { south: 23, west: -89, north: 32.5, east: -79 },
  },
  {
    key: "ga",
    host: "511ga.org",
    label: "Georgia DOT",
    region: "Georgia",
    country: "United States",
    bounds: { south: 29, west: -87, north: 36.5, east: -79.5 },
  },
  {
    key: "ut",
    host: "udottraffic.utah.gov",
    label: "Utah DOT",
    region: "Utah",
    country: "United States",
    bounds: { south: 36, west: -116, north: 43, east: -107.5 },
  },
  {
    key: "nc",
    host: "drivenc.gov",
    label: "NCDOT",
    region: "North Carolina",
    country: "United States",
    bounds: { south: 32.5, west: -85.5, north: 37.5, east: -74.5 },
  },
  {
    key: "nv",
    host: "nvroads.com",
    label: "Nevada DOT",
    region: "Nevada",
    country: "United States",
    bounds: { south: 34, west: -121.5, north: 43, east: -112.5 },
  },
  {
    key: "az",
    host: "az511.gov",
    label: "Arizona DOT",
    region: "Arizona",
    country: "United States",
    bounds: { south: 30.5, west: -116, north: 38, east: -108 },
  },
  {
    // One site serves Maine, New Hampshire and Vermont from a single
    // camera table, so it's one entry here rather than three.
    key: "nweng",
    host: "newengland511.org",
    label: "New England 511",
    region: "New England",
    country: "United States",
    bounds: { south: 41, west: -74.5, north: 48.5, east: -66.5 },
  },
  {
    key: "ct",
    host: "ctroads.org",
    label: "Connecticut DOT",
    region: "Connecticut",
    country: "United States",
    bounds: { south: 40, west: -74.5, north: 43, east: -71 },
  },
  {
    key: "la",
    host: "511la.org",
    label: "Louisiana DOTD",
    region: "Louisiana",
    country: "United States",
    bounds: { south: 28, west: -95, north: 34, east: -87.5 },
  },
  {
    key: "nb",
    host: "511.gnb.ca",
    label: "New Brunswick DTI",
    region: "New Brunswick",
    country: "Canada",
    bounds: { south: 44, west: -70, north: 49, east: -63 },
  },
  {
    key: "ns",
    host: "511.novascotia.ca",
    label: "Nova Scotia TPW",
    region: "Nova Scotia",
    country: "Canada",
    bounds: { south: 42, west: -67, north: 48, east: -59 },
  },
  {
    key: "mb",
    host: "manitoba511.ca",
    label: "Manitoba Transportation",
    region: "Manitoba",
    country: "Canada",
    bounds: { south: 48, west: -103, north: 61, east: -88 },
  },
  {
    key: "nl",
    host: "511nl.ca",
    label: "Newfoundland & Labrador TI",
    region: "Newfoundland and Labrador",
    country: "Canada",
    bounds: { south: 46, west: -68, north: 61, east: -52 },
  },
  {
    key: "pe",
    host: "511.gov.pe.ca",
    label: "Prince Edward Island TIE",
    region: "Prince Edward Island",
    country: "Canada",
    bounds: { south: 45, west: -65.5, north: 47.5, east: -61 },
  },
];

/**
 * Page sizes to try, largest first. The platform caps a page at 100 rows
 * whatever `length` asks for, and 100 is right for every site but one.
 *
 * Alberta answers `length: 100` with its HTML error page and a 500,
 * every time, while 50 works (10, 25, 40 and 50 were accepted; 20, 60,
 * 75, 99 and 100 were refused, which looks like a row that fails to
 * serialise at particular offsets rather than a size limit). The retry
 * loop only repeated the same request, so the province was absent from
 * the map with nothing but a warning in the log. Falling back to a
 * smaller page is general on purpose: the next site to develop the same
 * fault recovers without anyone having to notice it first.
 */
const PAGE_SIZES = [100, 50];

/**
 * Guard against a jurisdiction reporting an implausible recordsTotal.
 * Sized above the biggest real feed with room to spare — Florida alone
 * publishes ~4,800 cameras, so a lower cap silently truncated it.
 * Counted in rows so the ceiling means the same thing at either page size.
 */
const MAX_ROWS = 8000;

/** Attempts per page. These endpoints throw occasional 500s under paging. */
const PAGE_ATTEMPTS = 3;

interface CameraImage {
  imageUrl?: string;
  refreshRateMs?: number;
  disabled?: boolean;
  blocked?: boolean;
}

interface CameraRecord {
  id?: number;
  location?: string;
  roadway?: string;
  county?: string | null;
  city?: string | null;
  images?: CameraImage[];
  latLng?: { geography?: { wellKnownText?: string } };
}

/**
 * Some records carry a literal placeholder where the location should be —
 * Florida publishes "[not provided]" for 31 of its ~4,900 cameras, and a
 * couple more are blank. Treated as text it becomes the camera's name on
 * the map, which looks like a bug in this app rather than a gap in the
 * feed. Rare enough to ignore in aggregate, but it surfaced immediately
 * on a twelve-camera route where four tiles read "[not provided]".
 */
function meaningful(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\[[^\]]*\]$/.test(text)) return null;
  if (/^(n\/?a|unknown|not provided|-+)$/i.test(text)) return null;
  return text;
}

/** Coordinates arrive as WKT — `POINT (-75.90045 40.30142)`, lon first. */
function parsePoint(wkt: string | undefined): { lat: number; lon: number } | null {
  if (!wkt) return null;
  const match = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt);
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

async function fetchPage(
  site: StateSite,
  start: number,
  length: number
): Promise<{ rows: CameraRecord[]; total: number }> {
  const query = encodeURIComponent(JSON.stringify({ columns: [], start, length }));
  const response = await fetch(`https://${site.host}/List/GetData/Cameras?query=${query}`, {
    headers: {
      // These endpoints sit behind the public map UI and return an HTML
      // challenge page to clients that don't look like a browser.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${site.host} responded ${response.status}`);

  // A challenged request answers 200 with an HTML body, so this can't
  // trust the status code alone.
  const text = await response.text();
  if (text.trimStart().startsWith("<")) throw new Error(`${site.host} returned HTML, not JSON`);

  const payload = JSON.parse(text) as { data?: CameraRecord[]; recordsTotal?: number };
  return { rows: payload.data ?? [], total: payload.recordsTotal ?? 0 };
}

function toCams(site: StateSite, rows: CameraRecord[]): Cam[] {
  const cams: Cam[] = [];
  let outOfBounds = 0;

  for (const row of rows) {
    const point = parsePoint(row.latLng?.geography?.wellKnownText);
    if (!point || row.id == null) continue;

    const { south, west, north, east } = site.bounds;
    if (point.lat < south || point.lat > north || point.lon < west || point.lon > east) {
      outOfBounds++;
      continue;
    }

    // A site can carry several views; the first usable one becomes the pin
    // rather than stacking eight markers on one mast.
    const image = row.images?.find((candidate) => candidate.imageUrl && !candidate.disabled && !candidate.blocked);
    if (!image?.imageUrl) continue;

    const refreshMs = image.refreshRateMs;
    const refreshSeconds = typeof refreshMs === "number" && refreshMs > 0 ? Math.round(refreshMs / 1000) : 120;

    cams.push({
      id: `511${site.key}:${row.id}`,
      title:
        meaningful(row.location) ??
        meaningful(row.roadway) ??
        `${site.region} camera ${row.id}`,
      place: meaningful(row.city) ?? meaningful(row.county) ?? meaningful(row.roadway) ?? site.region,
      country: site.country,
      lat: point.lat,
      lon: point.lon,
      category: "traffic",
      // Same reasoning as Caltrans: thousands of them, so they fill in as
      // you zoom rather than competing at continental scale.
      prominence: 2,
      stillUrl: `https://${site.host}${image.imageUrl}`,
      refreshSeconds,
      sourcePage: `https://${site.host}/cctv`,
      provider: site.label,
    });
  }

  if (outOfBounds > 0) {
    console.warn(`[cams] ${site.host}: dropped ${outOfBounds} camera(s) with coordinates outside ${site.region}`);
  }

  return cams;
}

/**
 * One page, retried on failure.
 *
 * These endpoints intermittently answer 500 while paging — observed on
 * Georgia's page 1 and New York's page 25 in the same run. Retrying with
 * a short backoff clears almost all of them.
 */
async function fetchPageWithRetry(
  site: StateSite,
  start: number,
  length: number
): Promise<{ rows: CameraRecord[]; total: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(site, start, length);
    } catch (error) {
      lastError = error;
      if (attempt < PAGE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

async function fetchState(site: StateSite): Promise<Cam[]> {
  // The first page decides the page size for the whole jurisdiction: the
  // largest one the site will actually answer. See PAGE_SIZES.
  let pageSize = PAGE_SIZES[0];
  let first: { rows: CameraRecord[]; total: number } | null = null;
  let firstError: unknown;
  for (const candidate of PAGE_SIZES) {
    try {
      first = await fetchPageWithRetry(site, 0, candidate);
      pageSize = candidate;
      break;
    } catch (error) {
      firstError = error;
    }
  }
  if (!first) throw firstError;

  const cams = toCams(site, first.rows);

  const pages = Math.ceil(Math.min(MAX_ROWS, first.total) / pageSize);
  let failedPages = 0;

  for (let page = 1; page < pages; page++) {
    try {
      const next = await fetchPageWithRetry(site, page * pageSize, pageSize);
      // An empty page before the end is the platform telling us it's done.
      if (next.rows.length === 0) break;
      cams.push(...toCams(site, next.rows));
    } catch {
      // Skip the page rather than abandoning the jurisdiction. Bailing out
      // here used to cost thousands of cameras over one transient 500 —
      // Georgia failing on page 1 dropped it from ~4,000 cameras to ~100.
      failedPages++;
      if (failedPages > 5) {
        console.warn(`[cams] ${site.host}: giving up after ${failedPages} failed pages`);
        break;
      }
    }
  }

  if (failedPages > 0) {
    console.warn(`[cams] ${site.host}: ${failedPages} page(s) unavailable — roster is partial`);
  }

  return cams;
}

export const oneStop511Source: CamSource = {
  key: "511",
  label: "State 511 traffic cameras",
  async fetchCams() {
    const settled = await Promise.allSettled(STATES.map(fetchState));
    const cams: Cam[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") cams.push(...result.value);
      else console.warn(`[cams] 511 ${STATES[index].host} failed:`, result.reason);
    }
    return cams;
  },
};
