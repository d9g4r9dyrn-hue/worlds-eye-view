import type { Cam, CamSource } from "../types";

/**
 * Washington State DOT cameras: about 1,600 across the state, including
 * the mountain passes, the ferry terminals and around a hundred small
 * airfield cameras.
 *
 * WSDOT's Traveler Information API needs a registered access code for
 * its JSON and XML endpoints, but the same service publishes the camera
 * list as KML with no code at all, which is the file read here. It is
 * parsed with a regex for the same reason as the NZTA feed: the shape is
 * flat and machine generated, and a malformed placemark costs one camera
 * rather than the source.
 *
 * The list includes a few dozen cameras that WSDOT relays from other
 * owners (Oregon's TripCheck, a ski lodge, a county). Only frames on
 * WSDOT's own image host are kept: the Oregon ones arrive through the
 * TripCheck adapter anyway, and the rest are private hosts this app has
 * no arrangement with.
 */

const FEED_URL = "https://www.wsdot.wa.gov/Traffic/api/HighwayCameras/kml.aspx";
const IMAGE_HOST = "https://images.wsdot.wa.gov/";

function cdata(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(block);
  return match ? match[1].trim() : null;
}

export const wsdotSource: CamSource = {
  key: "wsdot",
  label: "Washington State DOT",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/vnd.google-earth.kml+xml, application/xml",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`WSDOT responded ${response.status}`);

    const kml = await response.text();
    const cams: Cam[] = [];
    const seen = new Set<string>();

    for (const match of kml.matchAll(/<Placemark id="ID (\d+)">([\s\S]*?)<\/Placemark>/g)) {
      const id = match[1];
      const block = match[2];
      if (seen.has(id)) continue;

      const stillUrl = /<img[^>]*\ssrc="([^"]+)"/.exec(block)?.[1];
      if (!stillUrl || !stillUrl.startsWith(IMAGE_HOST)) continue;

      // KML order is lon,lat with an optional altitude.
      const coords = /<coordinates>\s*(-?[\d.]+),(-?[\d.]+)/.exec(block);
      if (!coords) continue;
      const lon = Number(coords[1]);
      const lat = Number(coords[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // Washington, generously bounded.
      if (lat < 44.5 || lat > 50 || lon < -126 || lon > -115.5) continue;

      const path = stillUrl.slice(IMAGE_HOST.length).toLowerCase();
      const isAirport = path.startsWith("airports/");
      const isFerry = path.startsWith("wsf/");

      seen.add(id);
      cams.push({
        id: `wsdot:${id}`,
        title: cdata(block, "name") || `Washington camera ${id}`,
        place: "Washington",
        country: "United States",
        lat,
        lon,
        category: isAirport ? "airport" : isFerry ? "harbor" : "traffic",
        // Airfield and ferry-terminal views are scenery rather than
        // asphalt, so they sit above the plain highway cameras.
        prominence: isAirport || isFerry ? 4 : 2,
        stillUrl,
        // Highway cameras update every two minutes; airfields are slower,
        // and re-fetching those early only returns the same frame.
        refreshSeconds: isAirport ? 600 : 120,
        sourcePage: "https://wsdot.com/travel/real-time/cameras",
        provider: "Washington State DOT",
      });
    }

    return cams;
  },
};
