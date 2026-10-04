import type { Cam, CamSource } from "../types";

/**
 * Ohio DOT OHGO cameras: about 1,150 sites on Ohio's interstates and
 * state routes.
 *
 * OHGO has a documented public API (publicapi.ohgo.com) that needs a
 * registered key, so it is not used. This is the endpoint the OHGO map
 * itself loads its camera markers from, which answers without one. Each
 * site lists one or more views with a stable image URL on ODOT's camera
 * host; the first view becomes the pin.
 *
 * The image URLs are published with an explicit `:443`, which is left
 * alone: it is the default port, and rewriting a URL the agency
 * publishes is one more thing that could drift.
 */

const FEED_URL = "https://api.ohgo.com/roadmarkers/cameras";

interface OhgoSite {
  Id?: string;
  Latitude?: number;
  Longitude?: number;
  Location?: string;
  Description?: string;
  Cameras?: { LargeURL?: string; SmallURL?: string }[];
}

export const ohgoSource: CamSource = {
  key: "ohgo",
  label: "Ohio DOT (OHGO)",
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
    if (!response.ok) throw new Error(`OHGO responded ${response.status}`);

    const sites = (await response.json()) as OhgoSite[];
    if (!Array.isArray(sites)) throw new Error("OHGO did not return a camera list");

    const cams: Cam[] = [];

    for (const site of sites) {
      if (!site.Id) continue;

      const lat = site.Latitude;
      const lon = site.Longitude;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // Ohio, generously bounded.
      if (lat < 37.5 || lat > 43 || lon < -86 || lon > -79.5) continue;

      const view = site.Cameras?.find((candidate) => candidate.LargeURL || candidate.SmallURL);
      const stillUrl = view?.LargeURL || view?.SmallURL;
      if (!stillUrl || !/^https:\/\//i.test(stillUrl)) continue;

      cams.push({
        id: `ohgo:${site.Id}`,
        title: site.Location?.trim() || site.Description?.trim() || `Ohio camera ${site.Id}`,
        place: "Ohio",
        country: "United States",
        lat,
        lon,
        category: "traffic",
        prominence: 2,
        stillUrl,
        // Sampled frames were between a few seconds and a minute old.
        refreshSeconds: 60,
        sourcePage: "https://www.ohgo.com/cameras",
        provider: "Ohio DOT",
      });
    }

    return cams;
  },
};
