import type { Cam, CamSource } from "../types";

/**
 * WeatherSTEM sky cameras.
 *
 * WeatherSTEM puts a weather station with a camera on schools, fire
 * stations, stadiums and county buildings, and publishes each one on a
 * public page per county. They matter here out of proportion to their
 * number for two reasons. They are not road cameras: each is a wide
 * 1920x1080 view of sky and neighbourhood, which is the kind of picture
 * the map is short of. And they sit in places no highway feed reaches;
 * in Pinellas County the nearest DOT camera to much of Largo and
 * Clearwater is several kilometres off, while there is a station on six
 * Largo fire houses.
 *
 * There is no roster endpoint that works without a key, so this reads
 * what the public pages themselves load: the county page lists its
 * stations, and each station page carries that station's coordinates and
 * camera names. Those pages embed a good deal more than that, including
 * things the operator plainly did not mean to publish. Only the five
 * fields below are read and nothing else is kept.
 *
 * A station page is about 370KB, so this is the heaviest roster per
 * camera in the catalogue. It is read once a day (see registry.ts), a few
 * pages at a time.
 *
 * Measured 2026-10-04: 16 county sites in Florida answer, about 145
 * stations between them. A station can stay listed long after its camera
 * stops uploading: Largo Fire Station 41's picture was two weeks old. So
 * each picture's Last-Modified is checked and anything older than
 * MAX_AGE_HOURS is left out.
 */

/** County sites confirmed to answer. Each is `<name>.weatherstem.com`. */
const DOMAINS = [
  "pinellas",
  "hillsborough",
  "manatee",
  "sarasota",
  "polk",
  "charlotte",
  "lake",
  "alachua",
  "volusia",
  "duval",
  "leon",
  "okaloosa",
  "stlucie",
  "broward",
  "miamidade",
];

const IMAGE_HOST = "https://images.weatherstem.com";
const MAX_AGE_HOURS = 6;
const CONCURRENCY = 4;

const USER_AGENT = "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)";

/** Florida with a wide margin. A station outside it has bad coordinates. */
const BOUNDS = { south: 23, west: -89, north: 32.5, east: -79 };

interface StationPage {
  station?: {
    handle?: string;
    name?: string;
    address?: string;
    lat?: string | number;
    lon?: string | number;
    active?: number;
    sky_cameras?: { handle?: string; lat?: string | number; lon?: string | number }[];
  };
}

interface DomainPage {
  domain?: { stations?: { handle?: string; active?: number; name?: string }[] };
}

/**
 * The pages hand their data to the browser as one escaped JSON string
 * inside a script tag. This pulls that string out and parses it.
 */
async function readModel<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);

  const html = await response.text();
  const marker = "unescape('";
  const start = html.indexOf(`${marker}%7B`);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = html.indexOf("'", from);
  if (end < 0) return null;

  try {
    return JSON.parse(decodeURIComponent(html.slice(from, end))) as T;
  } catch {
    return null;
  }
}

/** True when the camera's current picture is recent enough to be worth showing. */
async function isFresh(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const modified = Date.parse(response.headers.get("last-modified") ?? "");
    // No date at all is not evidence of staleness; keep it.
    if (!Number.isFinite(modified)) return true;
    return Date.now() - modified < MAX_AGE_HOURS * 3_600_000;
  } catch {
    return false;
  }
}

/** "400 S Ft Harrison Ave, Clearwater, FL 33756, USA" gives "Clearwater". */
function cityFrom(address: string | undefined): string | null {
  // Found by the state, not by position: some addresses leave the
  // country off, and counting from the end then returned the street.
  const parts = (address ?? "").split(",").map((part) => part.trim());
  const state = parts.findIndex((part) => /^FL\b/.test(part));
  return state >= 1 ? parts[state - 1] || null : null;
}

async function fetchStation(domain: string, handle: string): Promise<Cam[]> {
  const page = await readModel<StationPage>(`https://${domain}.weatherstem.com/${handle}`);
  const station = page?.station;
  if (!station || station.active === 0) return [];

  const cams: Cam[] = [];
  const name = station.name?.trim() || handle;
  // A stadium can have three cameras. Named apart, or they read as one
  // camera listed three times.
  const several = (station.sky_cameras ?? []).length > 1;
  for (const camera of station.sky_cameras ?? []) {
    if (!camera.handle) continue;

    const lat = Number(camera.lat ?? station.lat);
    const lon = Number(camera.lon ?? station.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) continue;

    const stillUrl = `${IMAGE_HOST}/skycamera/${domain}/${handle}/${camera.handle}/snapshot.jpg`;
    if (!(await isFresh(stillUrl))) continue;

    cams.push({
      id: `wxstem:${domain}-${handle}-${camera.handle}`,
      title: several ? `${name}, ${camera.handle}` : name,
      place: cityFrom(station.address),
      country: "United States",
      lat,
      lon,
      category: "weather",
      // Above the road cameras around it on purpose. This is a wide view
      // of a neighbourhood, and where one exists it is usually the only
      // camera for some distance that is not pointed at an interchange.
      prominence: 5,
      stillUrl,
      refreshSeconds: 300,
      sourcePage: `https://${domain}.weatherstem.com/${handle}`,
      provider: "WeatherSTEM",
    });
  }
  return cams;
}

/** Runs `task` over `items`, a few at a time, and gathers what succeeds. */
async function pooled<T, R>(items: T[], task: (item: T) => Promise<R[]>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = 0;
  let lastError = "";
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      // Tried twice. From the server this source returned a quarter of
      // what it returns from a desk, and it did so without a word because
      // failures here were dropped; the second attempt and the count
      // below are so that neither happens quietly again.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results.push(...(await task(item)));
          break;
        } catch (error) {
          if (attempt === 2) {
            // One page failing costs one station, not the county.
            failed++;
            lastError = error instanceof Error ? error.message : String(error);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  if (failed > 0) console.warn(`[cams] WeatherSTEM: ${failed} of ${items.length} station pages failed, last: ${lastError}`);
  return results;
}

export const weatherStemSource: CamSource = {
  key: "weatherstem",
  label: "WeatherSTEM sky cameras",
  async fetchCams() {
    const stations: { domain: string; handle: string }[] = [];

    const domains = await Promise.allSettled(
      DOMAINS.map((domain) => readModel<DomainPage>(`https://${domain}.weatherstem.com/`))
    );
    for (const [index, result] of domains.entries()) {
      if (result.status !== "fulfilled") {
        console.warn(`[cams] WeatherSTEM ${DOMAINS[index]} failed:`, result.reason);
        continue;
      }
      for (const station of result.value?.domain?.stations ?? []) {
        if (station.handle && station.active !== 0) stations.push({ domain: DOMAINS[index], handle: station.handle });
      }
    }

    const cams = await pooled(stations, ({ domain, handle }) => fetchStation(domain, handle));
    console.log(`[cams] WeatherSTEM: ${stations.length} stations listed, ${cams.length} cameras with a current picture`);
    return cams;
  },
};
