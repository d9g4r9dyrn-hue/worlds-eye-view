import sharp from "sharp";
import type { Cam, CamSource } from "../types";

/**
 * SANRAL i-traffic, South Africa.
 *
 * The national roads agency's freeway cameras around Johannesburg and
 * Pretoria, Durban, and Cape Town. It is the only source on the African
 * continent that is a first-party feed and not a slice of Windy.
 *
 * The site runs the same vendor platform as the North American 511 sites
 * in onestop511.ts and serves frames from the same `/map/Cctv/<id>` path,
 * but its camera table (`/List/GetData/Cameras`) answers 404. What does
 * answer is the feed behind the map pins, `/map/mapIcons/Cameras`, which
 * has an id and a coordinate for every camera and nothing else. Names
 * come from the per-camera tooltip the map shows on click.
 *
 * Measured 2026-10-04: 1,234 cameras listed, and in a sample of 15 only 6
 * returned a real picture. The other 9 returned a white "unavailable"
 * card. Left in, those would each win a thumbnail slot, fail, and leave a
 * hole until the map asked again, across most of the country. So every
 * frame is fetched once when the roster is read and only cameras showing
 * a real picture are kept, then names are fetched for the keepers. That
 * is about 1,700 small requests per refresh, which is why this source is
 * read twice a day (see registry.ts) and a few requests at a time.
 */

const HOST = "https://www.i-traffic.co.za";
const CONCURRENCY = 6;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** South Africa with a margin. */
const BOUNDS = { south: -36, west: 15, north: -21, east: 34 };

/**
 * Ids end in the number of the regional system that owns the camera
 * ("711--2"). Used for the province because names are not consistent
 * enough to rely on: Gauteng's start "GP", KwaZulu-Natal's start with
 * the road.
 */
const REGIONS: Record<string, string> = {
  "2": "Gauteng",
  "3": "KwaZulu-Natal",
  "4": "Western Cape",
  "14": "Eastern Cape",
};

/** Fallback for a region not listed above: names often start with the province, "GP CCTV N12 711". */
const PROVINCES: Record<string, string> = {
  GP: "Gauteng",
  KZN: "KwaZulu-Natal",
  WC: "Western Cape",
  EC: "Eastern Cape",
  FS: "Free State",
  MP: "Mpumalanga",
  LP: "Limpopo",
  NW: "North West",
  NC: "Northern Cape",
};

interface MapIcon {
  itemId?: string;
  location?: [number, number];
}

/** The same test the thumbnail proxy applies to "unavailable" cards: bright and nearly featureless. */
async function showsARealPicture(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${HOST}/map/Cctv/${id}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const stats = await sharp(Buffer.from(await response.arrayBuffer()), { failOn: "none" }).stats();
    const mean = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / stats.channels.length;
    return !(mean >= 200 && stats.entropy < 3.5);
  } catch {
    return false;
  }
}

async function nameOf(id: string): Promise<string | null> {
  try {
    const response = await fetch(`${HOST}/tooltip/Cameras/${id}?lang=en`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const match = /<b>\s*([^<]{2,80}?)\s*<\/b>/.exec(await response.text());
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export const iTrafficSource: CamSource = {
  key: "itraffic",
  label: "SANRAL i-traffic",
  async fetchCams() {
    const response = await fetch(`${HOST}/map/mapIcons/Cameras`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`i-traffic responded ${response.status}`);

    const text = await response.text();
    if (text.trimStart().startsWith("<")) throw new Error("i-traffic returned HTML, not JSON");
    const icons = JSON.parse(text) as MapIcon[];

    const candidates = icons.filter((icon) => {
      const [lat, lon] = icon.location ?? [];
      return (
        typeof icon.itemId === "string" &&
        /^[\w-]+$/.test(icon.itemId) &&
        typeof lat === "number" &&
        typeof lon === "number" &&
        lat >= BOUNDS.south &&
        lat <= BOUNDS.north &&
        lon >= BOUNDS.west &&
        lon <= BOUNDS.east
      );
    });

    const cams: Cam[] = [];
    let next = 0;
    async function worker() {
      while (next < candidates.length) {
        const icon = candidates[next++];
        const id = icon.itemId as string;
        if (!(await showsARealPicture(id))) continue;

        const name = await nameOf(id);
        const province = REGIONS[id.split("--")[1] ?? ""] ?? (name ? PROVINCES[name.split(/\s+/)[0]] : undefined);
        const [lat, lon] = icon.location as [number, number];

        cams.push({
          id: `itraffic:${id}`,
          title: name ?? `South Africa camera ${id}`,
          place: province ?? null,
          country: "South Africa",
          lat,
          lon,
          category: "traffic",
          // The same rank as the other national road feeds outside North
          // America (Spain, New South Wales).
          prominence: 3,
          stillUrl: `${HOST}/map/Cctv/${id}`,
          refreshSeconds: 120,
          sourcePage: `${HOST}/`,
          provider: "SANRAL i-traffic",
        });
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // The workers finish in whatever order the network allows. Sorted so
    // the roster is the same from one refresh to the next.
    return cams.sort((a, b) => (a.id < b.id ? -1 : 1));
  },
};
