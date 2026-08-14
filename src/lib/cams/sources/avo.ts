import type { Cam, CamSource } from "../types";

/**
 * Alaska Volcano Observatory ashcams — ~65 cameras pointed at active
 * volcanoes and at the communities downwind of them. Free, no key, and
 * genuinely the most interesting imagery in the whole catalog.
 *
 * AVO publishes no JSON index, so this reads the public webcam page and
 * pulls out the current frame each camera is showing. Unlike Caltrans
 * (whose image URL is stable and self-updating), AVO's URLs carry the
 * capture timestamp — so a cached AVO URL goes stale, which is why the
 * registry re-fetches this source far more often than the others.
 */

const WEBCAM_PAGE = "https://avo.alaska.edu/webcam/";

/**
 * Camera id prefix -> where to put the pin.
 *
 * For a volcano camera the pin sits on the volcano it watches, not on the
 * camera mast — the mast can be 30km away on a ridge, and "Shishaldin" is
 * what someone is actually looking for on the map. Community ashcams
 * (which exist to watch for ashfall, not to watch a specific summit) sit
 * on the community instead. Summit coordinates are the published ones;
 * community coordinates are the town centre, so both are the named place
 * rather than a surveyed camera position.
 */
const PLACEMENTS: Record<string, { name: string; lat: number; lon: number; volcano: boolean }> = {
  // Volcanoes
  akutan: { name: "Akutan", lat: 54.134, lon: -165.986, volcano: true },
  amchitka: { name: "Amchitka", lat: 51.57, lon: 179.1, volcano: true },
  aniakchak: { name: "Aniakchak", lat: 56.906, lon: -158.209, volcano: true },
  aug: { name: "Augustine", lat: 59.363, lon: -153.435, volcano: true },
  augustine: { name: "Augustine", lat: 59.363, lon: -153.435, volcano: true },
  cleveland: { name: "Mount Cleveland", lat: 52.825, lon: -169.945, volcano: true },
  gsitkin: { name: "Great Sitkin", lat: 52.076, lon: -176.13, volcano: true },
  iliamna: { name: "Iliamna", lat: 60.032, lon: -153.09, volcano: true },
  kanaga: { name: "Kanaga", lat: 51.923, lon: -177.168, volcano: true },
  katmai: { name: "Katmai", lat: 58.279, lon: -154.963, volcano: true },
  kupreanof: { name: "Kupreanof", lat: 56.011, lon: -159.797, volcano: true },
  lsitkin: { name: "Little Sitkin", lat: 51.953, lon: 178.543, volcano: true },
  okif: { name: "Okmok", lat: 53.43, lon: -168.13, volcano: true },
  okmok: { name: "Okmok", lat: 53.43, lon: -168.13, volcano: true },
  pavlof: { name: "Pavlof", lat: 55.417, lon: -161.894, volcano: true },
  redoubt: { name: "Redoubt", lat: 60.485, lon: -152.742, volcano: true },
  semi: { name: "Semisopochnoi", lat: 51.93, lon: 179.58, volcano: true },
  shishaldin: { name: "Shishaldin", lat: 54.756, lon: -163.97, volcano: true },
  spurr: { name: "Mount Spurr", lat: 61.299, lon: -152.251, volcano: true },
  tanaga: { name: "Tanaga", lat: 51.885, lon: -178.146, volcano: true },
  veniaminof: { name: "Veniaminof", lat: 56.17, lon: -159.38, volcano: true },

  // Community ashcams
  anchorage: { name: "Anchorage", lat: 61.2181, lon: -149.9003, volcano: false },
  anchorpoint: { name: "Anchor Point", lat: 59.7769, lon: -151.8314, volcano: false },
  beluga: { name: "Beluga", lat: 61.18, lon: -151.03, volcano: false },
  chistochina: { name: "Chistochina", lat: 62.57, lon: -144.66, volcano: false },
  chitina: { name: "Chitina", lat: 61.515, lon: -144.437, volcano: false },
  coldbay: { name: "Cold Bay", lat: 55.2, lon: -162.72, volcano: false },
  egegik: { name: "Egegik", lat: 58.216, lon: -157.375, volcano: false },
  falsepass: { name: "False Pass", lat: 54.85, lon: -163.41, volcano: false },
  kenai: { name: "Kenai", lat: 60.554, lon: -151.258, volcano: false },
  kingsalmon: { name: "King Salmon", lat: 58.68, lon: -156.66, volcano: false },
  knik: { name: "Knik", lat: 61.45, lon: -149.15, volcano: false },
  nelsonlagoon: { name: "Nelson Lagoon", lat: 56.0, lon: -161.2, volcano: false },
  nikiski: { name: "Nikiski", lat: 60.69, lon: -151.29, volcano: false },
  perryville: { name: "Perryville", lat: 55.91, lon: -159.15, volcano: false },
  portheiden: { name: "Port Heiden", lat: 56.95, lon: -158.63, volcano: false },
  sitka: { name: "Sitka", lat: 57.053, lon: -135.33, volcano: false },
  tazlina: { name: "Tolsona", lat: 62.11, lon: -145.98, volcano: false },
  tradingbay: { name: "Trading Bay", lat: 60.85, lon: -151.65, volcano: false },
};

/**
 * Camera ids come in three shapes — `augustine`, `akutan_av06`,
 * `anchorage-NW` — so the place key is whatever precedes the first
 * separator, lowercased. An id that doesn't resolve is dropped rather
 * than guessed at, which is what keeps a new AVO camera from silently
 * landing at the wrong coordinates.
 */
function placementFor(camId: string) {
  const key = camId.toLowerCase().split(/[_-]/)[0];
  return PLACEMENTS[key] ?? null;
}

/** `akutan_av06` -> "Akutan (av06)", `anchorage-NW` -> "Anchorage (NW)". */
function titleFor(camId: string, placeName: string): string {
  const suffix = camId.slice(camId.toLowerCase().split(/[_-]/)[0].length).replace(/^[_-]/, "");
  return suffix ? `${placeName} (${suffix})` : placeName;
}

export const avoSource: CamSource = {
  key: "avo",
  label: "Alaska Volcano Observatory",
  async fetchCams() {
    const response = await fetch(WEBCAM_PAGE, {
      headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://corticorp.news)" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`AVO responded ${response.status}`);
    const html = await response.text();

    // .../ashcam-api/images//<camId>/<year>/<dayOfYear>/<camId>-<stamp>.jpg
    // (the doubled slash is AVO's own, not a typo here)
    const pattern = /\/ashcam-api\/images\/\/([A-Za-z0-9_-]+)\/(\d{4})\/(\d{1,3})\/([A-Za-z0-9_.-]+\.jpg)/g;

    // A camera can appear more than once on the page; the capture stamp is
    // ISO basic format, so the lexicographically-largest filename is also
    // the newest frame.
    const newest = new Map<string, string>();
    for (const match of html.matchAll(pattern)) {
      const [, camId, year, doy, file] = match;
      const url = `https://avo.alaska.edu/ashcam-api/images//${camId}/${year}/${doy}/${file}`;
      const existing = newest.get(camId);
      if (!existing || file > existing.slice(existing.lastIndexOf("/") + 1)) newest.set(camId, url);
    }

    const cams: Cam[] = [];
    for (const [camId, stillUrl] of newest) {
      const placement = placementFor(camId);
      if (!placement) continue;

      cams.push({
        id: `avo:${camId}`,
        title: titleFor(camId, placement.name),
        place: "Alaska",
        country: "United States",
        lat: placement.lat,
        lon: placement.lon,
        category: placement.volcano ? "volcano" : "weather",
        // High enough that Alaska's volcanoes hold their thumbnail slots
        // at continental zoom against a wall of freeway cameras.
        prominence: placement.volcano ? 7 : 4,
        stillUrl,
        refreshSeconds: 600,
        sourcePage: WEBCAM_PAGE,
        provider: "USGS / Alaska Volcano Observatory",
      });
    }

    return cams;
  },
};
