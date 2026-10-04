import type { Cam, CamSource } from "../types";

/**
 * Icelandic Road Administration (Vegagerdin) road cameras: about 165
 * stations around the ring road, the highland passes and the Westfjords.
 *
 * Open data from the administration's own data service (gagnaveita),
 * with no key. For a road feed these are unusually good pictures, since
 * most stations look out over open country, fjords or mountain passes.
 * They also fill the North Atlantic, where the map has nothing else
 * between Canada and Europe.
 *
 * The feed lists one row per view, and a station has up to four views
 * sharing a mast and identical coordinates. Only the first view of each
 * station becomes a pin, for the same reason as the Finnish feed.
 */

const FEED_URL = "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1";

interface ViewRow {
  /** Station number, shared by every view at one site. */
  Maelist_nr?: number;
  /** Station name. */
  Myndavel?: string;
  /** Road name. */
  Vegheiti?: string;
  /** Image URL. */
  Slod?: string;
  /** Latitude. */
  Breidd?: number;
  /** Longitude. */
  Lengd?: number;
}

export const vegagerdinSource: CamSource = {
  key: "vegagerdin",
  label: "Vegagerdin (Iceland)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Vegagerdin responded ${response.status}`);

    const rows = (await response.json()) as ViewRow[];
    if (!Array.isArray(rows)) throw new Error("Vegagerdin did not return a camera list");

    const cams: Cam[] = [];
    const seen = new Set<number>();

    for (const row of rows) {
      if (row.Maelist_nr == null || !row.Slod || seen.has(row.Maelist_nr)) continue;
      if (!/^https:\/\/.+\.(jpe?g|png)$/i.test(row.Slod)) continue;

      const lat = row.Breidd;
      const lon = row.Lengd;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // Iceland, generously bounded.
      if (lat < 62.5 || lat > 67.5 || lon < -25.5 || lon > -12.5) continue;

      seen.add(row.Maelist_nr);
      cams.push({
        id: `vegagerdin:${row.Maelist_nr}`,
        title: row.Myndavel?.trim() || `Iceland camera ${row.Maelist_nr}`,
        place: row.Vegheiti?.trim() || "Iceland",
        country: "Iceland",
        lat,
        lon,
        // Filed as traffic because that is what they are, but ranked well
        // above ordinary road cameras: the views are landscape, and the
        // country would otherwise be thinned off the world view entirely.
        category: "traffic",
        prominence: 5,
        stillUrl: row.Slod,
        // Sampled frames were between one and eleven minutes old.
        refreshSeconds: 600,
        sourcePage: "https://umferdin.is/en",
        provider: "Vegagerdin (Icelandic Road Administration)",
      });
    }

    return cams;
  },
};
