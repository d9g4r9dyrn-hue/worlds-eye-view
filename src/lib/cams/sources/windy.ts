import type { Cam, CamCategory, CamSource } from "../types";

/**
 * Windy Webcams API — the only source here with genuinely global reach,
 * and the only one that carries the categories this map is short of
 * (observatories, harbours, mountains, wildlife) rather than yet more
 * highways.
 *
 * Requires WINDY_API_KEY. Without it this returns nothing and the map
 * falls back to the key-free sources, which is why the feature works out
 * of the box and simply gets wider once a key is set.
 *
 * ## Built around the free tier's two real limits
 *
 * **Image URLs expire after 10 minutes.** Far sooner than any sensible
 * roster refresh, so the roster deliberately does *not* trust the URL it
 * saw at fetch time. It keeps only the durable metadata — coordinates,
 * title, category — and mints a fresh URL per camera at the moment
 * somebody actually looks at one (see `resolveStillUrl`). The alternative,
 * re-reading the entire catalogue every few minutes purely to keep links
 * alive, would burn hundreds of calls an hour for cameras nobody opened.
 *
 * **Offset is capped at 1,000 webcams.** So this can reach ~1,000
 * cameras, not the tens of thousands Windy holds; the professional tier
 * that lifts it to 10,000 is €9,990/year. Because the reachable slice is
 * small and arbitrary, these are given a higher prominence than the
 * traffic feeds — a thousand cameras spread over entire continents should
 * win their thumbnail slots, since outside North America they are often
 * the only thing there at all.
 */

const ENDPOINT = "https://api.windy.com/webcams/api/v3/webcams";

/** Windy's own per-request ceiling. */
const PAGE_SIZE = 50;

/**
 * Free tier refuses offsets beyond this, so paging further returns
 * nothing. 20 pages of 50.
 */
const MAX_OFFSET = 1_000;

/** How long a minted image URL is treated as usable. Windy's free tier expires them at 10 minutes. */
export const WINDY_URL_TTL_SECONDS = 480;

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
 * View count is a decent proxy for "is this one of the famous ones" — a
 * Times Square cam and a cam in someone's back garden are otherwise
 * indistinguishable in the payload. Mapped onto a 5-9 band: higher than
 * the traffic feeds because outside North America these are frequently
 * the only cameras on screen, but still below a hand-picked promotion.
 */
function prominenceFor(webcam: WindyWebcam): number {
  const views = webcam.viewCount ?? 0;
  if (views > 500_000) return 9;
  if (views > 100_000) return 8;
  if (views > 20_000) return 7;
  if (views > 5_000) return 6;
  return 5;
}

function apiKey(): string | null {
  return process.env.WINDY_API_KEY || null;
}

async function windyFetch(url: URL | string, key: string): Promise<Response> {
  return fetch(url, {
    headers: { "x-windy-api-key": key },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
}

function pickImage(webcam: WindyWebcam): string | null {
  const images = webcam.images?.current;
  return images?.preview ?? images?.thumbnail ?? images?.icon ?? null;
}

/**
 * Fetches a single webcam purely to get a currently-valid image URL.
 *
 * Called from the thumbnail proxy, which caches the resulting frame for
 * this camera's refresh interval — so this is roughly one API call per
 * camera per interval, and only for cameras somebody opened, rather than
 * one per camera in the catalogue.
 */
async function resolveStillUrl(cam: Cam): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("WINDY_API_KEY is not set");

  const webcamId = cam.id.slice("windy:".length);
  const url = new URL(`${ENDPOINT}/${encodeURIComponent(webcamId)}`);
  url.searchParams.set("include", "images");

  const response = await windyFetch(url, key);
  if (!response.ok) throw new Error(`Windy webcam ${webcamId} responded ${response.status}`);

  const webcam = (await response.json()) as WindyWebcam;
  const image = pickImage(webcam);
  if (!image) throw new Error(`Windy webcam ${webcamId} returned no image`);
  return image;
}

async function fetchPage(key: string, offset: number): Promise<WindyWebcam[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  // `images` is still requested so a camera with no imagery at all can be
  // skipped at roster time rather than failing later on every view.
  url.searchParams.set("include", "images,location,categories,urls");

  const response = await windyFetch(url, key);
  if (!response.ok) throw new Error(`Windy responded ${response.status}`);

  const payload = (await response.json()) as { webcams?: WindyWebcam[] };
  return payload.webcams ?? [];
}

export const windySource: CamSource = {
  key: "windy",
  label: "Windy Webcams",
  async fetchCams() {
    const key = apiKey();
    if (!key) return [];

    const cams: Cam[] = [];

    for (let offset = 0; offset < MAX_OFFSET; offset += PAGE_SIZE) {
      let batch: WindyWebcam[];
      try {
        batch = await fetchPage(key, offset);
      } catch (error) {
        // Keep whatever already paged in — a rate limit partway through
        // should thin the map, not blank it.
        console.warn(`[cams] Windy offset ${offset} failed:`, error);
        break;
      }
      if (batch.length === 0) break;

      for (const webcam of batch) {
        const location = webcam.location;
        if (!webcam.webcamId || !location) continue;
        if (webcam.status && webcam.status !== "active") continue;
        // No imagery now means no imagery later; skip rather than let it
        // fail on every view.
        if (!pickImage(webcam)) continue;

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
          // Recorded for reference, but not relied on: it will have
          // expired long before most views. resolveStillUrl is what the
          // proxy actually uses.
          stillUrl: pickImage(webcam) ?? "",
          resolveStillUrl,
          refreshSeconds: WINDY_URL_TTL_SECONDS,
          sourcePage: webcam.urls?.detail ?? null,
          provider: "Windy.com",
        });
      }

      if (batch.length < PAGE_SIZE) break;
    }

    return cams;
  },
};
