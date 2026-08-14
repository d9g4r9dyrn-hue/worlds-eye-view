import type { Cam, CamSource } from "../types";

/**
 * Fintraffic's Digitraffic road weather cameras — ~810 stations across
 * Finland, open data with no key.
 *
 * This is the first source that puts real coverage on continental Europe,
 * and it reaches far enough north to be genuinely interesting: in
 * midwinter a chunk of these sit in polar night while the rest of the map
 * is in daylight.
 *
 * Each station has several presets (fixed camera angles). Only the first
 * usable one becomes a pin — the presets share a mast and identical
 * coordinates, so plotting them all would stack a pile of markers on one
 * spot for no benefit.
 */

const STATIONS_URL = "https://tie.digitraffic.fi/api/weathercam/v1/stations";

/** Preset images are served from a separate host, keyed by preset id. */
const IMAGE_BASE = "https://weathercam.digitraffic.fi";

interface StationFeature {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    name?: string;
    collectionStatus?: string;
    presets?: { id?: string; inCollection?: boolean }[];
  };
}

/**
 * Station names come through as `kt51_Inkoo` or `vt4_Oulu_Kello` — a road
 * designation, then the place. Flip it so the map shows the place first,
 * which is what anyone is actually scanning for.
 */
function readableName(raw: string): string {
  const parts = raw.split("_").filter(Boolean);
  if (parts.length < 2) return raw;
  const [road, ...rest] = parts;
  return `${rest.join(" ")} (${road})`;
}

export const digitrafficSource: CamSource = {
  key: "digitraffic",
  label: "Fintraffic (Finland)",
  async fetchCams() {
    const response = await fetch(STATIONS_URL, {
      headers: {
        // Digitraffic hard-rejects requests that don't advertise gzip —
        // it answers 200 with the plain-text message "Use of gzip
        // compression is required", which then fails JSON parsing rather
        // than surfacing as an HTTP error.
        "Accept-Encoding": "gzip",
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Digitraffic responded ${response.status}`);

    const payload = (await response.json()) as { features?: StationFeature[] };
    const cams: Cam[] = [];

    for (const feature of payload.features ?? []) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;
      if (!feature.id || !props || !coords) continue;

      // GeoJSON order is [lon, lat, elevation].
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      if (lat < 55 || lat > 72 || lon < 18 || lon > 33) continue;

      if (props.collectionStatus && props.collectionStatus !== "GATHERING") continue;

      const preset = props.presets?.find((candidate) => candidate.id && candidate.inCollection !== false);
      if (!preset?.id) continue;

      cams.push({
        id: `digitraffic:${preset.id}`,
        title: readableName(props.name ?? String(feature.id)),
        place: "Finland",
        country: "Finland",
        lat,
        lon,
        category: "traffic",
        prominence: 3,
        stillUrl: `${IMAGE_BASE}/${preset.id}.jpg`,
        // Digitraffic refreshes most presets on a ~10 minute cycle.
        refreshSeconds: 600,
        sourcePage: "https://liikennetilanne.fintraffic.fi/",
        provider: "Fintraffic",
      });
    }

    return cams;
  },
};
