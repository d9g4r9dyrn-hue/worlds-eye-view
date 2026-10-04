import type { Cam, CamSource } from "../types";

/**
 * Travel Midwest cameras for Illinois: about 1,090 from IDOT, the
 * Illinois Tollway and the Kane, Lake and DuPage county systems, mostly
 * the Chicago region plus the Peoria district.
 *
 * Travel Midwest is the Illinois DOT's own traveller site (operated with
 * the Lake Michigan Interstate Gateway Alliance). Its map asks for
 * cameras with a JSON POST carrying a bounding box, and answers GeoJSON
 * with a stable snapshot URL per camera; no key or session is involved,
 * and the site's robots.txt disallows nothing.
 *
 * The same response also relays Indiana, Wisconsin and Kentucky cameras.
 * Those are dropped here because each already arrives from its own
 * state's feed (carsprogram.ts and onestop511.ts), and showing them
 * twice would stack two markers on every mast.
 */

const FEED_URL = "https://travelmidwest.com/lmiga/cameraMap.json";

/** Illinois with a margin; the service clips to whatever box it is given. */
const BBOX = [-92.5, 36.5, -86.5, 43];

/** Feed `src` values that belong to another state's own adapter. */
const OTHER_STATES = /^(InDOT|WisDOT|KYTC)\b/i;

interface CameraFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    id?: string;
    locDesc?: string;
    src?: string;
    /** True when the operator has disabled the camera. */
    dis?: boolean;
    remUrls?: string[];
  };
}

export const travelMidwestSource: CamSource = {
  key: "travelmidwest",
  label: "Travel Midwest (Illinois)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify({ bbox: BBOX }),
      // Slow: the full Illinois box took 29 seconds when measured.
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Travel Midwest responded ${response.status}`);

    const payload = (await response.json()) as { features?: CameraFeature[] };
    const cams: Cam[] = [];
    const seen = new Set<string>();

    for (const feature of payload.features ?? []) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;
      if (!props?.id || !coords || props.dis) continue;
      if (props.src && OTHER_STATES.test(props.src)) continue;
      if (seen.has(props.id)) continue;

      const stillUrl = props.remUrls?.find((url) => /^https:\/\/.+\.(jpe?g|png)(\?|$)/i.test(url));
      if (!stillUrl) continue;

      // GeoJSON order is [lon, lat].
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      if (lat < BBOX[1] || lat > BBOX[3] || lon < BBOX[0] || lon > BBOX[2]) continue;

      seen.add(props.id);
      cams.push({
        id: `travelmidwest:${props.id}`,
        title: props.locDesc?.trim() || "Illinois traffic camera",
        place: "Illinois",
        country: "United States",
        lat,
        lon,
        category: "traffic",
        prominence: 2,
        stillUrl,
        // Sampled snapshots were under ten minutes old, most under three.
        refreshSeconds: 300,
        sourcePage: "https://travelmidwest.com/",
        // The county and tollway systems are credited by name; the feed's
        // labels for IDOT's own districts ("IDOT D1 Camera") are not names
        // a reader would recognise.
        provider: props.src && !/^IDOT/i.test(props.src) ? props.src.trim() : "Illinois DOT",
      });
    }

    return cams;
  },
};
