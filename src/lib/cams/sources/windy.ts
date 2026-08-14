import type { Cam, CamCategory, CamSource } from "../types";

/**
 * Windy Webcams API — tens of thousands of geolocated public webcams
 * worldwide, and the only source here that gives real global coverage
 * rather than one region or one agency.
 *
 * Requires WINDY_API_KEY. Without it this source returns nothing and the
 * map falls back to the key-free sources, which is why the feature works
 * out of the box and simply gets denser once a key is set.
 */

const ENDPOINT = "https://api.windy.com/webcams/api/v3/webcams";

/** Windy's own per-request ceiling. */
const PAGE_SIZE = 50;

/**
 * How many pages to pull per refresh. Windy's free tier is metered per
 * request, so this caps a refresh at 40 calls (~2,000 cams) rather than
 * walking the entire catalogue and burning the daily allowance in one go.
 */
const MAX_PAGES = 40;

interface WindyWebcam {
  webcamId?: number;
  title?: string;
  status?: string;
  viewCount?: number;
  categories?: { id?: string; name?: string }[];
  images?: { current?: { preview?: string; thumbnail?: string; icon?: string } };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  urls?: { detail?: string };
}

/** Windy's category vocabulary is much finer than ours; fold it down. */
const CATEGORY_MAP: Record<string, CamCategory> = {
  traffic: "traffic",
  airport: "airport",
  harbor: "harbor",
  harbour: "harbor",
  beach: "harbor",
  mountain: "mountain",
  ski: "mountain",
  volcano: "volcano",
  observatory: "observatory",
  meteo: "weather",
  weather: "weather",
  city: "city",
  square: "city",
  building: "city",
  park: "wildlife",
  nature: "wildlife",
  animals: "wildlife",
  zoo: "wildlife",
};

function categoryFor(webcam: WindyWebcam): CamCategory {
  for (const category of webcam.categories ?? []) {
    const mapped = category.id ? CATEGORY_MAP[category.id.toLowerCase()] : undefined;
    if (mapped) return mapped;
  }
  return "city";
}

/**
 * Windy exposes view count, which is a decent proxy for "is this one of
 * the famous ones" — a Times Square cam and a cam in someone's back
 * garden are otherwise indistinguishable in the payload. Mapped onto a
 * 3-8 band so a popular Windy cam can compete with a volcano but never
 * outrank a hand-picked marquee cam.
 */
function prominenceFor(webcam: WindyWebcam): number {
  const views = webcam.viewCount ?? 0;
  if (views > 500_000) return 8;
  if (views > 100_000) return 7;
  if (views > 20_000) return 6;
  if (views > 5_000) return 5;
  if (views > 1_000) return 4;
  return 3;
}

async function fetchPage(apiKey: string, offset: number): Promise<WindyWebcam[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("include", "images,location,categories,urls");

  const response = await fetch(url, {
    headers: { "x-windy-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Windy responded ${response.status}`);

  const payload = (await response.json()) as { webcams?: WindyWebcam[] };
  return payload.webcams ?? [];
}

export const windySource: CamSource = {
  key: "windy",
  label: "Windy Webcams",
  async fetchCams() {
    const apiKey = process.env.WINDY_API_KEY;
    if (!apiKey) return [];

    const cams: Cam[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let batch: WindyWebcam[];
      try {
        batch = await fetchPage(apiKey, page * PAGE_SIZE);
      } catch (error) {
        // Keep whatever we already paged in — a rate limit partway through
        // should thin the map, not blank it.
        console.warn(`[cams] Windy page ${page} failed:`, error);
        break;
      }
      if (batch.length === 0) break;

      for (const webcam of batch) {
        const location = webcam.location;
        const still = webcam.images?.current?.preview ?? webcam.images?.current?.thumbnail;
        if (!webcam.webcamId || !location || !still) continue;
        if (webcam.status && webcam.status !== "active") continue;

        const lat = location.latitude;
        const lon = location.longitude;
        if (typeof lat !== "number" || typeof lon !== "number") continue;

        cams.push({
          id: `windy:${webcam.webcamId}`,
          title: webcam.title?.trim() || "Webcam",
          place: location.city?.trim() || location.region?.trim() || null,
          country: location.country?.trim() || null,
          lat,
          lon,
          category: categoryFor(webcam),
          prominence: prominenceFor(webcam),
          stillUrl: still,
          refreshSeconds: 600,
          sourcePage: webcam.urls?.detail ?? null,
          provider: "Windy.com",
        });
      }

      if (batch.length < PAGE_SIZE) break;
    }

    return cams;
  },
};
