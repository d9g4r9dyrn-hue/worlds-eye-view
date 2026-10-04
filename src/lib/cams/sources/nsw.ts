import type { Cam, CamSource } from "../types";

/**
 * Transport for NSW Live Traffic cameras: about 240 across Sydney and the
 * main New South Wales corridors, open data with no key.
 *
 * The first Australian source in the catalogue. Together with New
 * Zealand it is what stops the southern hemisphere being one country
 * wide on the world view.
 *
 * The feed is GeoJSON and names its own licence (the Live Traffic Cameras
 * dataset on opendata.transport.nsw.gov.au). The Open Data Hub also
 * offers the same list behind a registered API key; this is the file the
 * public Live Traffic map reads, which needs nothing. Each feature
 * carries a stable UUID and a stable image URL that always serves the
 * newest frame, so the roster only needs re-reading a few times a day.
 */

const FEED_URL = "https://data.livetraffic.com/cameras/traffic-cam.json";

interface CameraFeature {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    region?: string;
    title?: string;
    view?: string;
    href?: string;
  };
}

/** Region codes as published, mapped to something a reader recognises. */
const REGIONS: Record<string, string> = {
  SYD_MET: "Sydney",
  SYD_NORTH: "Sydney North",
  SYD_SOUTH: "Sydney South",
  SYD_WEST: "Sydney West",
  REG_NORTH: "Northern NSW",
  REG_SOUTH: "Southern NSW",
  REG_WEST: "Western NSW",
};

export const nswSource: CamSource = {
  key: "nsw",
  label: "Transport for NSW (Australia)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Live Traffic NSW responded ${response.status}`);

    const payload = (await response.json()) as { features?: CameraFeature[] };
    const cams: Cam[] = [];

    for (const feature of payload.features ?? []) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;
      if (!feature.id || !props?.href || !coords) continue;
      if (!/^https:\/\//i.test(props.href)) continue;

      // GeoJSON order is [lon, lat].
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // New South Wales, generously bounded.
      if (lat < -38.5 || lat > -27.5 || lon < 140 || lon > 154.5) continue;

      cams.push({
        id: `nsw:${feature.id}`,
        title: props.title?.trim() || props.view?.trim() || "NSW traffic camera",
        place: (props.region && REGIONS[props.region]) || "New South Wales",
        country: "Australia",
        lat,
        lon,
        category: "traffic",
        // Above the North American feeds for the same reason as New
        // Zealand: a few hundred cameras carry a whole continent's share
        // of the map, so they should not be thinned away at world zoom.
        prominence: 3,
        stillUrl: props.href,
        // Frames carried Last-Modified times under a minute old when sampled.
        refreshSeconds: 60,
        sourcePage: "https://www.livetraffic.com/traffic-cameras",
        provider: "Transport for NSW",
      });
    }

    return cams;
  },
};
