import type { Cam, CamSource } from "../types";

/**
 * North Dakota DOT travel cameras: about 190 roadside sites across the
 * state, most of them weather stations on the open prairie.
 *
 * The NDDOT travel map loads this GeoJSON file directly; it needs no
 * key. Each site lists several fixed views (west, north, east and a
 * pavement close-up) that share one mast, so only one becomes a pin. The
 * pavement view is skipped when there is any other choice, because a
 * close-up of asphalt is the least interesting picture a site has.
 */

const FEED_URL = "https://travelfiles.dot.nd.gov/geojson_nc/cameras.json";

interface SiteFeature {
  id?: string | number;
  geometry?: { coordinates?: number[] };
  properties?: {
    Region?: string;
    Cameras?: { Description?: string; FullPath?: string; Direction?: string }[];
  };
}

export const ndDotSource: CamSource = {
  key: "nddot",
  label: "North Dakota DOT",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`NDDOT responded ${response.status}`);

    const payload = (await response.json()) as { features?: SiteFeature[] };
    const cams: Cam[] = [];

    for (const feature of payload.features ?? []) {
      const coords = feature.geometry?.coordinates;
      if (feature.id == null || !coords) continue;

      const views = (feature.properties?.Cameras ?? []).filter((view) =>
        /^https:\/\//i.test(view.FullPath ?? "")
      );
      const view = views.find((candidate) => !/pavement/i.test(candidate.Direction ?? "")) ?? views[0];
      if (!view?.FullPath) continue;

      // GeoJSON order is [lon, lat].
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // North Dakota, generously bounded.
      if (lat < 45 || lat > 50 || lon < -105.5 || lon > -95.5) continue;

      cams.push({
        id: `nddot:${feature.id}`,
        // Descriptions end with the owner ("Ray - West (US 2 MP 51.3) - NDDOT"),
        // which the provider credit already says.
        title: view.Description?.replace(/\s+-\s+NDDOT\s*$/i, "").trim() || `North Dakota camera ${feature.id}`,
        place: feature.properties?.Region?.trim() || "North Dakota",
        country: "United States",
        lat,
        lon,
        category: "traffic",
        prominence: 2,
        stillUrl: view.FullPath,
        refreshSeconds: 600,
        sourcePage: "https://travel.dot.nd.gov/",
        provider: "North Dakota DOT",
      });
    }

    return cams;
  },
};
