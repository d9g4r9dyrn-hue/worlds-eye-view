import type { Cam, CamSource } from "../types";

/**
 * Michigan DOT Mi Drive cameras: about 800, mostly the Detroit, Grand
 * Rapids and Lansing freeways.
 *
 * The Mi Drive camera list page fills its table from this JSON endpoint,
 * which needs no key. It is an awkward feed: the rows were built for an
 * HTML table, so the coordinates and the camera id exist only inside a
 * "Go to" link in the `county` cell, and the frame URL only inside an
 * `<img>` tag in the `image` cell. Both are pulled out with a regex, and
 * a row where either is missing is skipped rather than guessed at.
 */

const FEED_URL = "https://mdotjboss.state.mi.us/MiDrive/camera/list";

interface MiDriveRow {
  route?: string;
  county?: string;
  location?: string;
  image?: string;
}

export const miDriveSource: CamSource = {
  key: "midrive",
  label: "Michigan DOT (Mi Drive)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Mi Drive responded ${response.status}`);

    const rows = (await response.json()) as MiDriveRow[];
    if (!Array.isArray(rows)) throw new Error("Mi Drive did not return a camera list");

    const cams: Cam[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const link = /lat=(-?[\d.]+)&(?:amp;)?lon=(-?[\d.]+)&(?:amp;)?zoom=\d+&(?:amp;)?id=(\d+)/.exec(row.county ?? "");
      const image = /<img[^>]*\ssrc="([^"]+)"/.exec(row.image ?? "");
      if (!link || !image) continue;

      const id = link[3];
      if (seen.has(id)) continue;

      const lat = Number(link[1]);
      const lon = Number(link[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // Michigan, generously bounded.
      if (lat < 41 || lat > 48.5 || lon < -91 || lon > -82) continue;

      const stillUrl = image[1].replace(/&amp;/g, "&");
      if (!/^https:\/\//i.test(stillUrl)) continue;

      // The county cell reads "Wayne County <a ...>Go to</a>".
      const county = (row.county ?? "").split("<")[0].trim();
      const route = row.route?.trim() ?? "";
      const location = row.location?.trim() ?? "";

      seen.add(id);
      cams.push({
        id: `midrive:${id}`,
        title: `${route} ${location}`.trim() || `Michigan camera ${id}`,
        place: county || "Michigan",
        country: "United States",
        lat,
        lon,
        category: "traffic",
        prominence: 2,
        stillUrl,
        refreshSeconds: 120,
        sourcePage: "https://mdotjboss.state.mi.us/MiDrive/cameras",
        provider: "Michigan DOT",
      });
    }

    return cams;
  },
};
