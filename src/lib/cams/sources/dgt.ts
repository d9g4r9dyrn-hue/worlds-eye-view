import type { Cam, CamSource } from "../types";

/**
 * Spain's national traffic authority (DGT) cameras: about 1,950 on the
 * motorways and main roads of mainland Spain and the islands.
 *
 * The largest single block of European coverage in the catalogue. DGT
 * publishes its camera inventory as a DATEX II document on the National
 * Access Point (nap.dgt.es), the open-data portal every EU member state
 * runs for road data; there is no key and no registration. Each device
 * carries WGS84 coordinates, a road name, a province and a stable JPEG
 * URL that always holds the newest frame.
 *
 * The document is 3.7 MB of XML, parsed with a regex for the same reason
 * as the NZTA feed: the shape is flat and machine generated, only four
 * text nodes are needed, and a malformed device costs one camera rather
 * than the source. The older infocar.dgt.es DATEX endpoint that most
 * write-ups point at now answers 404.
 *
 * The Basque Country and Catalonia run their own traffic services and
 * are largely absent from this feed.
 */

const FEED_URL = "https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v36.xml";

/** Element names are namespace-prefixed (`loc:latitude`), and the prefix is not guaranteed stable. */
function field(block: string, localName: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${localName}>([^<]*)</(?:\\w+:)?${localName}>`).exec(block);
  return match ? match[1].trim() : null;
}

/** Provinces arrive in capitals ("BURGOS", "A CORUÑA"). */
function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/**
 * Exact byte length of DGT's grey "IMAGEN NO DISPONIBLE" card.
 *
 * A camera that is down still answers 200 with this JPEG. The thumbnail
 * proxy's placeholder test does not catch it, because that test wants a
 * near-white image (mean luminance 200 or more) and this card is mid
 * grey (182). Measured across the whole feed, 129 of about 1,950
 * cameras were serving it, every copy byte-identical.
 */
const UNAVAILABLE_CARD_BYTES = 32_634;

/**
 * Asks for the frame's headers first and refuses the camera when they
 * describe the unavailable card, so the map treats it as down instead of
 * drawing a grey tile. It costs one extra HEAD per frame fetch, which is
 * per camera somebody is looking at, not per camera in the roster. If
 * the HEAD itself fails, the URL is returned and the real fetch decides.
 */
async function resolveStillUrl(cam: Cam): Promise<string> {
  let length: string | null = null;
  try {
    const response = await fetch(cam.stillUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    length = response.headers.get("content-length");
  } catch {
    return cam.stillUrl;
  }
  if (Number(length) === UNAVAILABLE_CARD_BYTES) {
    throw new Error(`${cam.id} is serving DGT's "imagen no disponible" card`);
  }
  return cam.stillUrl;
}

export const dgtSource: CamSource = {
  key: "dgt",
  label: "DGT (Spain)",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/xml, text/xml",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DGT responded ${response.status}`);

    const xml = await response.text();
    const cams: Cam[] = [];
    const seen = new Set<string>();

    for (const match of xml.matchAll(/<(?:\w+:)?device\s[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?device>/g)) {
      const id = match[1];
      const block = match[2];
      if (seen.has(id)) continue;
      if (field(block, "typeOfDevice") !== "camera") continue;

      const stillUrl = field(block, "deviceUrl");
      if (!stillUrl || !/^https:\/\/.+\.jpe?g$/i.test(stillUrl)) continue;

      const lat = Number(field(block, "latitude"));
      const lon = Number(field(block, "longitude"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // Spain including the Canaries, Ceuta and Melilla.
      if (lat < 27 || lat > 44.5 || lon < -18.5 || lon > 5) continue;

      const road = field(block, "roadName");
      const km = field(block, "kilometerPoint");
      const province = field(block, "province");
      const place = province ? titleCase(province) : null;

      seen.add(id);
      cams.push({
        id: `dgt:${id}`,
        title: road ? `${road}${km ? ` km ${km}` : ""}${place ? `, ${place}` : ""}` : `DGT camera ${id}`,
        place,
        country: "Spain",
        lat,
        lon,
        category: "traffic",
        // Above the North American feeds: this is most of what the map
        // has for southern Europe, so it should survive continental zoom.
        prominence: 3,
        stillUrl,
        resolveStillUrl,
        // Median frame age across the whole feed was six minutes.
        refreshSeconds: 300,
        sourcePage: "https://infocar.dgt.es/etraffic/",
        provider: "Dirección General de Tráfico",
      });
    }

    return cams;
  },
};
