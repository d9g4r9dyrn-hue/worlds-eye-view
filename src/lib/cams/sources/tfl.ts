import type { Cam, CamSource } from "../types";

/**
 * Transport for London JamCams — ~880 cameras across London, published
 * through TfL's open Place API with no key required for this endpoint.
 *
 * The one source here that covers a major world city densely, which
 * matters a lot for the map: without it, everything outside North
 * America is empty until a Windy key is configured.
 */

const ENDPOINT = "https://api.tfl.gov.uk/Place/Type/JamCam";

interface TflPlace {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: { key?: string; value?: string }[];
}

function propertyValue(place: TflPlace, key: string): string | undefined {
  return place.additionalProperties?.find((property) => property.key === key)?.value;
}

export const tflSource: CamSource = {
  key: "tfl",
  label: "TfL JamCams (London)",
  async fetchCams() {
    const response = await fetch(ENDPOINT, {
      headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://corticorp.news)" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`TfL responded ${response.status}`);

    const places = (await response.json()) as TflPlace[];
    const cams: Cam[] = [];

    for (const place of places) {
      const stillUrl = propertyValue(place, "imageUrl");
      if (!place.id || !stillUrl) continue;
      if (propertyValue(place, "available") === "false") continue;

      const lat = place.lat;
      const lon = place.lon;
      if (typeof lat !== "number" || typeof lon !== "number") continue;

      const view = propertyValue(place, "view");
      const name = place.commonName?.trim() || "London traffic camera";

      cams.push({
        id: `tfl:${place.id}`,
        title: view ? `${name} — ${view}` : name,
        place: "London",
        country: "United Kingdom",
        lat,
        lon,
        category: "traffic",
        // A notch above the highway cameras: these sit on named London
        // roads, so at city zoom they're recognisable places rather than
        // anonymous interchanges.
        prominence: 3,
        stillUrl,
        // TfL refreshes the S3 objects roughly every few minutes.
        refreshSeconds: 180,
        sourcePage: "https://www.tfl.gov.uk/traffic/status",
        provider: "Transport for London",
      });
    }

    return cams;
  },
};
