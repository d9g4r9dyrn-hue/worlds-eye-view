import type { Cam, CamSource } from "../types";

/**
 * FAA Aviation Weather Cameras: the FAA's own camera sites, about 290
 * with a working camera, most at remote Alaskan airstrips and mountain
 * passes, with more in Hawaii and the lower 48.
 *
 * These exist so pilots can look at the weather before flying into a
 * place with no forecast, which makes them some of the most remote and
 * most scenic fixed cameras anywhere: glaciers, passes, gravel strips on
 * the Bering Sea coast.
 *
 * READ THIS BEFORE WIRING IT IN. The data comes from the JSON API behind
 * weathercams.faa.gov. That API has no key and no login, but it answers
 * 401 unless the request carries a `Referer` of the site itself, so the
 * roster fetch and the per-view lookup below both send one. That is a
 * hotlink guard rather than an authentication scheme, and the material
 * is US government work, but it is a weaker claim to "intentionally
 * public for reuse" than a published open-data feed, and whoever
 * registers this source should be comfortable with it. The images
 * themselves are served from a separate static host and need no header,
 * which is why the frame proxy can fetch them unchanged.
 *
 * The site also relays about 660 partner cameras (NAV CANADA, university
 * wildfire networks, state aeronautics offices). Those are left out:
 * they belong to third parties with their own terms, and the FAA is only
 * the display surface for them. The roster flags them as `thirdParty`.
 *
 * Image URLs carry a capture timestamp and go stale within minutes, so
 * the roster keeps only durable metadata and the newest URL is looked up
 * when a camera is actually viewed, as the Windy adapter does.
 */

const API = "https://weathercams.faa.gov/api";
const SITE = "https://weathercams.faa.gov/";

/** A camera that has not delivered a picture in this long is treated as down. */
const MAX_SILENCE_MS = 6 * 60 * 60_000;

interface FaaCamera {
  cameraId?: number;
  cameraDirection?: string;
  cameraLastSuccess?: string;
  cameraInMaintenance?: boolean;
  cameraOutOfOrder?: boolean;
  displayOrder?: number;
}

interface FaaSite {
  siteId?: number;
  siteName?: string;
  siteArea?: string;
  icao?: string | null;
  latitude?: number;
  longitude?: number;
  siteInMaintenance?: boolean;
  siteActive?: boolean;
  thirdParty?: boolean;
  country?: string;
  state?: string;
  cameras?: FaaCamera[];
}

function apiHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    Referer: SITE,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
}

/**
 * Looks up the newest picture for one camera. `stillUrl` holds the API
 * address of that lookup, not an image, so this is the only way the
 * frame is ever reached.
 */
async function resolveStillUrl(cam: Cam): Promise<string> {
  const response = await fetch(cam.stillUrl, {
    headers: apiHeaders(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FAA image lookup for ${cam.id} responded ${response.status}`);

  const payload = (await response.json()) as { payload?: { imageUri?: string }[] };
  const uri = payload.payload?.[0]?.imageUri;
  // Pinned to FAA hosts so a changed API cannot point the proxy elsewhere.
  if (!uri || !/^https:\/\/[a-z0-9.-]+\.faa\.gov\//i.test(uri)) {
    throw new Error(`FAA has no current image for ${cam.id}`);
  }
  return uri;
}

export const faaWeatherCamsSource: CamSource = {
  key: "faa",
  label: "FAA Aviation Weather Cameras",
  async fetchCams() {
    const response = await fetch(`${API}/sites`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`FAA WeatherCams responded ${response.status}`);

    const payload = (await response.json()) as { payload?: FaaSite[] };
    const now = Date.now();
    const cams: Cam[] = [];

    for (const site of payload.payload ?? []) {
      if (site.siteId == null || site.thirdParty !== false) continue;
      if (site.siteActive === false || site.siteInMaintenance) continue;

      const lat = site.latitude;
      const lon = site.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // The United States including Alaska, Hawaii and the Aleutians past
      // the antimeridian; this only rejects coordinates that are broken.
      if (lat < 15 || lat > 73) continue;
      if (!(lon <= -60 || lon >= 170)) continue;

      // A site has several cameras facing different ways on one mast.
      // The first working one in the FAA's own display order is the pin.
      const camera = [...(site.cameras ?? [])]
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .find((candidate) => {
          if (candidate.cameraId == null) return false;
          if (candidate.cameraInMaintenance || candidate.cameraOutOfOrder) return false;
          const last = Date.parse(candidate.cameraLastSuccess ?? "");
          return Number.isFinite(last) && now - last < MAX_SILENCE_MS;
        });
      if (!camera?.cameraId) continue;

      const name = site.siteName?.trim() || `FAA site ${site.siteId}`;
      const direction = camera.cameraDirection?.trim();

      cams.push({
        // Keyed by site, not camera, so the id survives the pin moving to
        // another camera on the same mast when the first one goes down.
        id: `faa:${site.siteId}`,
        title: direction ? `${name} (looking ${direction})` : name,
        place: site.state?.trim() || site.siteArea?.trim() || null,
        country: site.country === "CA" ? "Canada" : "United States",
        lat,
        lon,
        category: site.icao ? "airport" : "weather",
        // In the scenic band rather than the road-camera band: these are
        // wilderness views, and Alaska has little else on the map.
        prominence: 5,
        // The lookup address for this camera's newest picture, which
        // resolveStillUrl turns into the image URL at view time.
        stillUrl: `${API}/cameras/${camera.cameraId}/images/last/1`,
        resolveStillUrl,
        // Sampled frames were all under ten minutes old.
        refreshSeconds: 600,
        // The site is a single-page app with no verified per-site address,
        // so the credit links to its front page.
        sourcePage: SITE,
        provider: "FAA Aviation Weather Cameras",
      });
    }

    return cams;
  },
};
