import type { Cam, CamSource } from "../types";

/**
 * QLDTraffic webcams: about 135 Queensland road cameras from the
 * Department of Transport and Main Roads, from Brisbane and the Gold
 * Coast up to Cairns.
 *
 * The API takes an `apikey` parameter, and the value below is not a
 * secret and was not registered for: it is the shared public key that
 * the department prints in the example requests of its own "QLDTraffic
 * website API specification" (v1.10, linked from the Developers and Data
 * page of qldtraffic.qld.gov.au, where the PDF was read to confirm it).
 * This adapter makes one request per roster refresh. If the department ever
 * rotates the published key the feed will answer 403 and this source
 * will fail on its own without affecting the others.
 *
 * Tropical north Queensland is otherwise empty on the map, so these get
 * the same raised prominence as the other southern-hemisphere feeds.
 */

const PUBLIC_API_KEY = "3e83add325cbb69ac4d8e5bf433d770b";
const FEED_URL = `https://api.qldtraffic.qld.gov.au/v1/webcams?apikey=${PUBLIC_API_KEY}`;

interface WebcamFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    id?: number;
    description?: string;
    district?: string;
    locality?: string;
    image_url?: string;
  };
}

export const qldTrafficSource: CamSource = {
  key: "qld",
  label: "QLDTraffic (Australia)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`QLDTraffic responded ${response.status}`);

    const payload = (await response.json()) as { features?: WebcamFeature[] };
    const cams: Cam[] = [];

    for (const feature of payload.features ?? []) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;
      if (props?.id == null || !props.image_url || !coords) continue;
      if (!/^https:\/\//i.test(props.image_url)) continue;

      // GeoJSON order is [lon, lat]. The declared datum is GDA2020, which
      // differs from WGS84 by under two metres, so no conversion is done.
      const [lon, lat] = coords;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      // Queensland, generously bounded.
      if (lat < -30 || lat > -9 || lon < 137 || lon > 155) continue;

      cams.push({
        id: `qld:${props.id}`,
        title: props.description?.trim() || `Queensland camera ${props.id}`,
        place: props.locality?.trim() || props.district?.trim() || "Queensland",
        country: "Australia",
        lat,
        lon,
        category: "traffic",
        prominence: 3,
        stillUrl: props.image_url,
        // Sampled frames were all under a minute old.
        refreshSeconds: 60,
        sourcePage: "https://qldtraffic.qld.gov.au/",
        provider: "Queensland Department of Transport and Main Roads",
      });
    }

    return cams;
  },
};
