import type { Cam, CamSource } from "../types";

/**
 * Oregon DOT TripCheck cameras: about 1,150 road cameras across Oregon,
 * with a few just over the Washington, Idaho and California lines.
 *
 * TripCheck's developer API needs a registered subscription key. The
 * public TripCheck map does not: it loads its camera inventory from a
 * static file on the same site, in Esri JSON, and that is what this
 * reads. Each record names an image file that always holds the newest
 * frame, so the roster is stable between refreshes.
 *
 * The record carries plain `latitude` and `longitude` attributes next to
 * a Web Mercator geometry; the attributes are used, which avoids
 * unprojecting.
 */

const FEED_URL = "https://tripcheck.com/Scripts/map/data/cctvinventory.js";
const IMAGE_BASE = "https://tripcheck.com/RoadCams/cams/";

interface InventoryFeature {
  attributes?: {
    cameraId?: number;
    filename?: string;
    latitude?: number;
    longitude?: number;
    route?: string;
    title?: string;
  };
}

export const tripCheckSource: CamSource = {
  key: "tripcheck",
  label: "Oregon DOT TripCheck",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json, application/javascript, */*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`TripCheck responded ${response.status}`);

    // Served as application/javascript, but the body is a bare JSON object.
    const text = await response.text();
    if (!text.trimStart().startsWith("{")) throw new Error("TripCheck inventory is not JSON");
    const payload = JSON.parse(text) as { features?: InventoryFeature[] };

    const cams: Cam[] = [];
    const seen = new Set<number>();

    for (const feature of payload.features ?? []) {
      const row = feature.attributes;
      if (!row || row.cameraId == null || !row.filename) continue;
      // One camera can publish several images; the first becomes the pin.
      if (seen.has(row.cameraId)) continue;
      // Filenames carry spaces and "@" ("I-5@Goshen_pid1504.jpg"), so
      // they are encoded rather than restricted to a tidy character set;
      // a strict pattern threw away 1,005 of 1,161 cameras when tried.
      // The only thing refused is a name that could leave the folder.
      if (!/\.(jpe?g|png)$/i.test(row.filename) || /[\\/]|\.\./.test(row.filename)) continue;

      const lat = row.latitude;
      const lon = row.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // Oregon and its border routes, generously bounded.
      // One record is published with longitude 226, which this drops.
      if (lat < 40.5 || lat > 47.5 || lon < -126 || lon > -115) continue;

      seen.add(row.cameraId);
      cams.push({
        id: `tripcheck:${row.cameraId}`,
        title: row.title?.trim() || `Oregon camera ${row.cameraId}`,
        place: row.route?.trim() || "Oregon",
        country: "United States",
        lat,
        lon,
        category: "traffic",
        prominence: 2,
        stillUrl: `${IMAGE_BASE}${encodeURIComponent(row.filename)}`,
        // Most ODOT cameras post a new frame about every five minutes.
        refreshSeconds: 300,
        sourcePage: "https://tripcheck.com/",
        provider: "Oregon DOT",
      });
    }

    return cams;
  },
};
