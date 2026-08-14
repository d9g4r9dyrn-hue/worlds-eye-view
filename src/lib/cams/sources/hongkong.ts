import type { Cam, CamSource } from "../types";

/**
 * Hong Kong Transport Department traffic snapshots — ~1,013 cameras,
 * open data, no key.
 *
 * The single biggest fix available for this map's worst gap. Before this,
 * the whole of Asia had 42 cameras; Hong Kong alone roughly doubles the
 * catalogue's non-Western coverage on its own.
 *
 * Two quirks in the inventory file, both of which will silently produce
 * garbage if you assume the usual:
 *
 * 1. It is **UTF-16LE**, not UTF-8. Read as UTF-8 it decodes to text
 *    interleaved with null bytes and every field lookup fails.
 * 2. It is **tab-separated**, despite the `.csv` extension. Splitting on
 *    commas yields one enormous column.
 *
 * It also already contains the fully-formed image URL per camera, so
 * there's no need to build one from a template — which is preferable,
 * since the published template and the file disagree on capitalisation
 * for some keys.
 */

const INVENTORY_URL = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv";

/** Generous box around Hong Kong; guards against a malformed coordinate. */
const BOUNDS = { south: 22.1, west: 113.8, north: 22.6, east: 114.5 };

/**
 * Descriptions repeat the camera key in brackets — "Aberdeen Praya Road
 * near Fish Market [H429F]" — which is noise on a map label where the id
 * is already known.
 */
function cleanDescription(raw: string): string {
  return raw.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}

export const hongKongSource: CamSource = {
  key: "hongkong",
  label: "Hong Kong Transport Department",
  async fetchCams() {
    const response = await fetch(INVENTORY_URL, {
      headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)" },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Hong Kong TD responded ${response.status}`);

    // Decoded explicitly rather than via response.text(), which would
    // assume UTF-8 and mangle every field.
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString("utf16le").replace(/^﻿/, "");

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error("Hong Kong TD inventory was empty");

    const columns = lines[0].split("\t").map((column) => column.replace(/^﻿/, "").trim().toLowerCase());
    const index = (name: string) => columns.indexOf(name);

    const keyAt = index("key");
    const latAt = index("latitude");
    const lonAt = index("longitude");
    const urlAt = index("url");
    const descAt = index("description");
    const districtAt = index("district");
    const regionAt = index("region");

    if (keyAt < 0 || latAt < 0 || lonAt < 0 || urlAt < 0) {
      throw new Error(`Hong Kong TD inventory columns changed: ${columns.join(",")}`);
    }

    const cams: Cam[] = [];

    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      const key = cells[keyAt]?.trim();
      const stillUrl = cells[urlAt]?.trim();
      if (!key || !stillUrl) continue;

      const lat = Number(cells[latAt]);
      const lon = Number(cells[lonAt]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) continue;

      const description = cleanDescription(cells[descAt]?.trim() ?? "");
      const district = cells[districtAt]?.trim() || null;
      const region = cells[regionAt]?.trim() || null;

      cams.push({
        id: `hongkong:${key}`,
        title: description || `Camera ${key}`,
        place: district || region,
        country: "Hong Kong",
        lat,
        lon,
        category: "traffic",
        // Above the North American highway feeds: this is one of very few
        // sources in Asia, so these should hold their slots at
        // continental zoom rather than being thinned into nothing.
        prominence: 4,
        stillUrl,
        // The department publishes a roughly two-minute refresh.
        refreshSeconds: 120,
        sourcePage: "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images",
        provider: "Hong Kong Transport Department",
      });
    }

    return cams;
  },
};
