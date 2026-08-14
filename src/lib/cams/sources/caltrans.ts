import type { Cam, CamSource } from "../types";

/**
 * Caltrans CCTV — ~1,700 California highway cameras, published as plain
 * JSON with no API key, no quota and no registration. One file per
 * district; the directory segment is unpadded (`d3`) but the filename is
 * zero-padded (`cctvStatusD03.json`), which is the only fiddly part.
 *
 * Each record also carries 12 previous frames at a coarser interval than
 * the live one, which is where the cam detail view's rewind strip comes
 * from — no extra requests, the feed already hands them over.
 */

const DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function feedUrl(district: number): string {
  return `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, "0")}.json`;
}

interface CaltransRecord {
  cctv?: {
    inService?: string;
    location?: {
      locationName?: string;
      nearbyPlace?: string;
      county?: string;
      route?: string;
      latitude?: string;
      longitude?: string;
    };
    imageData?: {
      static?: {
        currentImageURL?: string;
        currentImageUpdateFrequency?: string;
        referenceImage1UpdateAgoURL?: string;
      };
    };
  };
}

/**
 * Caltrans location names are written for traffic engineers, not readers —
 * "(C 348) SR-163 : Friars N/E_B". Strip the internal camera code and the
 * direction suffix so the map shows "SR-163 : Friars" instead.
 */
function cleanTitle(raw: string, route: string | undefined): string {
  const cleaned = raw
    .replace(/^\(\s*[A-Z]+\s*\d+\s*\)\s*/i, "")
    .replace(/_[A-Z]$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || route || "Caltrans camera";
}

/** The image path's own basename is the only stable per-camera key in the feed. */
function slugFromImageUrl(url: string): string | null {
  const match = /\/([^/]+)\.jpg(?:\?|$)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

async function fetchDistrict(district: number): Promise<Cam[]> {
  const response = await fetch(feedUrl(district), {
    headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://corticorp.news)" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Caltrans D${district} responded ${response.status}`);

  const payload = (await response.json()) as { data?: CaltransRecord[] };
  const records = payload.data ?? [];
  const cams: Cam[] = [];

  for (const record of records) {
    const cctv = record.cctv;
    if (!cctv || cctv.inService !== "true") continue;

    const location = cctv.location;
    const still = cctv.imageData?.static?.currentImageURL;
    if (!location || !still) continue;

    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    // The feed carries a fair number of 0/0 and blank-coordinate rows for
    // cameras that are listed but not actually placed — those would all
    // pile up off the coast of Africa. The envelope check that follows
    // catches the other failure mode seen across these DOT feeds: a
    // dropped minus sign, which flings a camera into the eastern
    // hemisphere. The box overshoots California by a few degrees on
    // purpose — the districts carry some cameras right on the Nevada and
    // Oregon lines, and those are real.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < 31 || lat > 43.5 || lon < -126 || lon > -112) continue;

    const slug = slugFromImageUrl(still);
    if (!slug) continue;

    // Advertised in minutes, and occasionally missing or zero.
    const minutes = Number(cctv.imageData?.static?.currentImageUpdateFrequency);
    const refreshSeconds = Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 120;

    cams.push({
      id: `caltrans:d${district}-${slug}`,
      title: cleanTitle(location.locationName ?? "", location.route),
      place: location.nearbyPlace?.trim() || location.county?.trim() || null,
      country: "United States",
      lat,
      lon,
      category: "traffic",
      // Deliberately low. There are ~1,700 of these and they must never
      // crowd out a launch pad or a volcano at continental zoom — they're
      // the fill of the quilt, visible once you actually zoom into
      // California.
      prominence: 2,
      stillUrl: still,
      refreshSeconds,
      sourcePage: "https://cwwp2.dot.ca.gov/vm/iframemap.htm",
      provider: "Caltrans",
    });
  }

  return cams;
}

export const caltransSource: CamSource = {
  key: "caltrans",
  label: "Caltrans highway cameras",
  async fetchCams() {
    // One slow or 500-ing district shouldn't cost us the other eleven.
    const settled = await Promise.allSettled(DISTRICTS.map(fetchDistrict));
    const cams: Cam[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") cams.push(...result.value);
      else console.warn("[cams] Caltrans district failed:", result.reason);
    }
    return cams;
  },
};
