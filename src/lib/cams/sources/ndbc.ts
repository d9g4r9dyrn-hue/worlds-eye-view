import type { Cam, CamSource } from "../types";

/**
 * NOAA National Data Buoy Center BuoyCAMs: cameras on about 75 moored
 * weather buoys in the open Atlantic, Pacific, Gulf of Mexico and Bering
 * Sea, some of them hundreds of miles from land.
 *
 * Nothing else in the catalogue is at sea. These put pins in places no
 * road camera can reach, and the picture is the actual sea state and sky
 * at that spot. NOAA publishes the station list as JSON for its own
 * BuoyCAM map, with no key, and US government work is public domain.
 *
 * Two things to know about the image. It is a panorama: each buoy
 * carries six cameras and NOAA stitches them into one strip about 2,880
 * by 300 pixels, so the map thumbnail is a thin band rather than a
 * normal frame, and the detail view is where it reads properly. And a
 * station with no recent picture has a null `img` (14 of 91 when this
 * was written); those are skipped and return on a later roster refresh.
 * Night frames are simply dark, which is the truth at that spot.
 *
 * The frame URL is the station endpoint rather than the dated filename
 * in the feed, because the endpoint always serves the newest picture
 * and so stays valid between roster refreshes.
 */

const FEED_URL = "https://www.ndbc.noaa.gov/buoycams.php";

interface BuoyRow {
  id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  /** Filename of the newest picture, or null when there is none. */
  img?: string | null;
}

export const ndbcSource: CamSource = {
  key: "ndbc",
  label: "NOAA BuoyCAMs",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`NDBC responded ${response.status}`);

    const rows = (await response.json()) as BuoyRow[];
    if (!Array.isArray(rows)) throw new Error("NDBC did not return a station list");

    const cams: Cam[] = [];

    for (const row of rows) {
      if (!row.id || !row.img) continue;
      // Station ids are short alphanumerics ("41002", "KLIH1"); the id is
      // placed in a query string, so anything else is refused.
      if (!/^[A-Za-z0-9]{3,8}$/.test(row.id)) continue;

      const lat = row.lat;
      const lon = row.lng;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      if (lat === 0 && lon === 0) continue;

      cams.push({
        id: `ndbc:${row.id}`,
        title: row.name?.trim() || `Buoy ${row.id}`,
        place: `NDBC station ${row.id}`,
        country: null,
        lat,
        lon,
        category: "weather",
        // Middling on purpose. A buoy in open ocean is alone in its patch
        // of the map and gets its slot whatever it is ranked. Ranking
        // only matters near a coast, and there a harbour or a city should
        // win: half the time a buoy's frame is a black strip, because it
        // is night at sea and there is nothing lit to look at.
        prominence: 4,
        hideWhenBlack: true,
        stillUrl: `https://www.ndbc.noaa.gov/buoycam.php?station=${row.id}`,
        // The newest pictures were stamped a little over an hour before
        // they were sampled, so there is no point asking more often.
        refreshSeconds: 1800,
        sourcePage: `https://www.ndbc.noaa.gov/station_page.php?station=${row.id}`,
        provider: "NOAA National Data Buoy Center",
      });
    }

    return cams;
  },
};
