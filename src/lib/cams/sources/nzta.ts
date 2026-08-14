import type { Cam, CamSource } from "../types";

/**
 * NZ Transport Agency Waka Kotahi state-highway cameras — ~320 across New
 * Zealand, open and key-free.
 *
 * Worth having well beyond the camera count: this is the only southern-
 * hemisphere source in the catalogue, so it's what makes the seasons and
 * the day/night terminator read correctly on a world view instead of the
 * map looking like the northern hemisphere is the whole planet.
 *
 * The feed is XML. It's parsed with a regex rather than by pulling in an
 * XML library, which is a deliberate trade: the shape is fixed, flat and
 * machine-generated, the fields needed are simple text nodes, and a
 * malformed record costs one camera rather than the whole source.
 */

const FEED_URL = "https://trafficnz.info/service/traffic/rest/4/cameras/all";
const BASE = "https://trafficnz.info";

/** First occurrence only — `<camera>` blocks contain nested `<journey>`/`<region>` elements that reuse names like `id` and `name`. */
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return match ? match[1].trim() : null;
}

export const nztaSource: CamSource = {
  key: "nzta",
  label: "NZ Transport Agency",
  async fetchCams() {
    const response = await fetch(FEED_URL, {
      headers: {
        Accept: "application/xml",
        "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
      },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`NZTA responded ${response.status}`);

    const xml = await response.text();
    const cams: Cam[] = [];

    for (const match of xml.matchAll(/<camera>([\s\S]*?)<\/camera>/g)) {
      const block = match[1];

      // `id` and `name` also appear inside the nested <journey>, <region>
      // and <way> elements. Reading the camera's own values means taking
      // only the part before the first nested element opens.
      const head = block.split("<journey>")[0];

      const id = field(head, "id");
      const imagePath = field(head, "imageUrl");
      if (!id || !imagePath) continue;

      // The feed flags cameras it already knows are down.
      if (field(block, "offline") === "true") continue;
      if (field(block, "underMaintenance") === "true") continue;

      const lat = Number(field(block, "latitude"));
      const lon = Number(field(block, "longitude"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // New Zealand, generously bounded — and it straddles the
      // antimeridian, so the Chathams legitimately report negative
      // longitudes near -176.
      if (lat < -48 || lat > -33) continue;
      if (!(lon >= 165 || lon <= -175)) continue;

      const name = field(head, "name");
      const description = field(head, "description");
      const region = /<region>[\s\S]*?<name>([^<]*)<\/name>/.exec(block)?.[1]?.trim() ?? null;

      cams.push({
        id: `nzta:${id}`,
        title: name?.trim() || description?.trim() || `NZ camera ${id}`,
        place: region,
        country: "New Zealand",
        lat,
        lon,
        category: "traffic",
        prominence: 3,
        stillUrl: `${BASE}${imagePath}`,
        refreshSeconds: 300,
        sourcePage: "https://www.journeys.nzta.govt.nz/traffic-cameras",
        provider: "NZ Transport Agency",
      });
    }

    return cams;
  },
};
