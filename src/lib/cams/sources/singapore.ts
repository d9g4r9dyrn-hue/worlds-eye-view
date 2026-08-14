import type { Cam, CamSource } from "../types";

/**
 * Singapore LTA expressway cameras, via data.gov.sg. Open, no key.
 *
 * Small — a few dozen at most — but it's the catalogue's only Asian
 * source, so it earns its place on coverage rather than volume.
 *
 * Unusual in one way that matters: the image URL changes on every
 * refresh, because each frame is published as a new object with its own
 * UUID rather than at a stable per-camera address. That means a cached
 * roster goes stale the way AVO's does, so the registry has to re-read
 * this source often or it will serve links to frames that have already
 * been superseded.
 */

const ENDPOINT = "https://api.data.gov.sg/v1/transport/traffic-images";

interface SgCamera {
  camera_id?: string;
  image?: string;
  timestamp?: string;
  location?: { latitude?: number; longitude?: number };
}

/**
 * Camera ids are LTA's internal numbers, which mean nothing to a reader.
 * A handful sit at landmarks worth naming; the rest fall back to the id.
 */
const KNOWN_LOCATIONS: Record<string, string> = {
  "1001": "Marina Coastal Expressway",
  "1002": "Marina Coastal Expressway — Central Blvd",
  "1003": "Marina Coastal Expressway — Maxwell Rd",
  "1004": "Marina Coastal Expressway — Marina Bay",
  "1005": "Marina Coastal Expressway — Sheares Ave",
  "1006": "Marina Coastal Expressway — Benjamin Sheares Bridge",
  "2701": "Woodlands Causeway",
  "2702": "Woodlands Checkpoint",
  "4703": "Tuas Second Link",
  "6710": "Pan Island Expressway — Changi",
};

export const singaporeSource: CamSource = {
  key: "singapore",
  label: "LTA Singapore",
  async fetchCams() {
    const response = await fetch(ENDPOINT, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`data.gov.sg responded ${response.status}`);

    const payload = (await response.json()) as { items?: { cameras?: SgCamera[] }[] };
    const cameras = payload.items?.[0]?.cameras ?? [];
    const cams: Cam[] = [];

    for (const camera of cameras) {
      const id = camera.camera_id;
      const still = camera.image;
      const lat = camera.location?.latitude;
      const lon = camera.location?.longitude;
      if (!id || !still || typeof lat !== "number" || typeof lon !== "number") continue;
      if (lat < 1.1 || lat > 1.55 || lon < 103.5 || lon > 104.2) continue;

      cams.push({
        id: `singapore:${id}`,
        title: KNOWN_LOCATIONS[id] ?? `Expressway camera ${id}`,
        place: "Singapore",
        country: "Singapore",
        lat,
        lon,
        category: "traffic",
        // A notch up: it's the only Asian source, so these should hold a
        // slot at continental zoom rather than being crowded out.
        prominence: 4,
        stillUrl: still,
        refreshSeconds: 120,
        sourcePage: "https://data.gov.sg/datasets/d_6cdb6cd0a4a48d5b1a8b1cf9ba7c1e6e/view",
        provider: "LTA Singapore",
      });
    }

    return cams;
  },
};
