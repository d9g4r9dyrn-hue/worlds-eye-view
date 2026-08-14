import type { Cam, CamSource } from "../types";

/**
 * DriveBC — ~1,060 cameras across British Columbia, open and key-free.
 *
 * A better-behaved feed than most: it publishes real coordinates for
 * every single camera, human-written captions ("Highway 16 at Hankin Road
 * in Telkwa, looking south") rather than engineering codes, and — rarest
 * of all — it tells you when it knows a camera has gone bad, via
 * `marked_stale` and `marked_delayed`. Those flags are honoured here, so
 * roughly 80 cameras the operator already knows are broken never reach
 * the map.
 *
 * Note that BC is *not* covered by the 511 adapter: DriveBC runs its own
 * software, which is why `511bc` doesn't exist and this does.
 */

const FEED_URL = "https://www.drivebc.ca/api/webcams/";
const IMAGE_BASE = "https://www.drivebc.ca";

interface DriveBcCamera {
  id?: number;
  name?: string;
  caption?: string;
  region_name?: string;
  highway?: string;
  marked_stale?: boolean;
  marked_delayed?: boolean;
  links?: { imageDisplay?: string };
  location?: { coordinates?: number[] };
}

/**
 * Captions are full sentences, which is more than any other feed gives —
 * but they're too long for a map label. The short `name` is the label;
 * the caption is better than nothing when a name is missing.
 */
function titleFor(camera: DriveBcCamera): string {
  const name = camera.name?.trim();
  if (name) return camera.highway ? `${name} — Hwy ${camera.highway}` : name;
  return camera.caption?.trim() || `BC camera ${camera.id}`;
}

export const driveBcSource: CamSource = {
  key: "drivebc",
  label: "DriveBC (British Columbia)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DriveBC responded ${response.status}`);

    const payload = (await response.json()) as DriveBcCamera[] | { webcams?: DriveBcCamera[] };
    const cameras = Array.isArray(payload) ? payload : (payload.webcams ?? []);
    const cams: Cam[] = [];

    for (const camera of cameras) {
      const imagePath = camera.links?.imageDisplay;
      if (camera.id == null || !imagePath) continue;

      // The operator's own health flags — worth trusting, since they know
      // things the image alone can't tell us.
      if (camera.marked_stale || camera.marked_delayed) continue;

      const coords = camera.location?.coordinates;
      if (!coords) continue;
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // British Columbia, loosely bounded — a few border cameras sit just
      // over the line into Alberta and Washington.
      if (lat < 47 || lat > 61 || lon < -140 || lon > -113) continue;

      // The path carries a `?t=` cache-buster that goes stale with the
      // roster. Stripping it leaves a stable URL that always serves the
      // newest frame, which is what the proxy's own caching wants.
      const cleanPath = imagePath.split("?")[0];

      cams.push({
        id: `drivebc:${camera.id}`,
        title: titleFor(camera),
        place: camera.region_name?.trim() || "British Columbia",
        country: "Canada",
        lat,
        lon,
        category: "traffic",
        prominence: 3,
        stillUrl: `${IMAGE_BASE}${cleanPath}`,
        refreshSeconds: 300,
        sourcePage: "https://www.drivebc.ca/",
        provider: "DriveBC",
      });
    }

    return cams;
  },
};
