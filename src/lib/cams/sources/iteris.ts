import type { Cam, CamSource } from "../types";

/**
 * 511 sites built by Iteris: South Carolina (about 790 cameras), South
 * Dakota (about 40 sites) and Montana (about 40).
 *
 * A third 511 vendor, after the two in onestop511.ts and carsprogram.ts.
 * Each of these public maps loads its camera layer from a static GeoJSON
 * file on the vendor's CDN, with no key:
 *
 *   https://<state>.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson
 *
 * Every two-letter state code was tried against that pattern and only
 * these three answer. The file comes in two shapes. South Dakota and
 * Montana list weather-station style sites, each with several still
 * views under `cameras`. South Carolina lists one streaming camera per
 * feature, with a PNG snapshot of the stream in `image_url`; the stream
 * itself is never used, since the app has no video path.
 *
 * The Dakotas and Montana are thin but worth having: they are the
 * emptiest part of the continental United States on the map.
 */

interface IterisSite {
  key: string;
  /** CDN subdomain. */
  state: string;
  label: string;
  region: string;
  sourcePage: string;
  refreshSeconds: number;
  bounds: { south: number; west: number; north: number; east: number };
}

const SITES: IterisSite[] = [
  {
    key: "sc",
    state: "sc",
    label: "South Carolina DOT",
    region: "South Carolina",
    sourcePage: "https://www.511sc.org/",
    // Stream snapshots; sampled ones were under a minute old.
    refreshSeconds: 180,
    bounds: { south: 31, west: -84.5, north: 36, east: -77.5 },
  },
  {
    key: "sd",
    state: "sd",
    label: "South Dakota DOT",
    region: "South Dakota",
    sourcePage: "https://www.sd511.org/",
    // Roadside weather stations; sampled frames were about ten minutes old.
    refreshSeconds: 600,
    bounds: { south: 41.5, west: -105.5, north: 47, east: -95 },
  },
  {
    key: "mt",
    state: "mt",
    label: "Montana DOT",
    region: "Montana",
    sourcePage: "https://www.511mt.net/",
    refreshSeconds: 600,
    // Montana publishes a few port-of-entry cameras just inside Wyoming
    // and Idaho, so the box reaches south of the state line.
    bounds: { south: 43, west: -117.5, north: 50, east: -103 },
  },
];

interface IterisFeature {
  id?: string | number;
  geometry?: { coordinates?: number[] };
  properties?: {
    id?: string | number;
    name?: string;
    description?: string;
    route?: string;
    jurisdiction?: string;
    /** Station shape: several still views. */
    cameras?: { image?: string; description?: string }[];
    /** Stream shape: one snapshot of the stream. */
    image_url?: string;
    active?: boolean;
    problem_stream?: boolean;
  };
}

function nonEmpty(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

async function fetchSite(site: IterisSite): Promise<Cam[]> {
  const host = `${site.state}.cdn.iteris-atis.com`;
  const response = await fetch(`https://${host}/geojson/icons/metadata/icons.cameras.geojson`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)",
    },
    signal: AbortSignal.timeout(40_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${host} responded ${response.status}`);

  const payload = (await response.json()) as { features?: IterisFeature[] };
  const cams: Cam[] = [];
  const seen = new Set<string>();

  for (const feature of payload.features ?? []) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;
    if (!props || !coords) continue;

    const localId = String(feature.id ?? props.id ?? "").trim();
    if (!localId || seen.has(localId)) continue;

    // The stream shape flags cameras the operator knows are down.
    if (props.active === false || props.problem_stream === true) continue;

    const stillUrl = props.image_url ?? props.cameras?.find((view) => view.image)?.image;
    if (!stillUrl || !/^https:\/\//i.test(stillUrl)) continue;

    // GeoJSON order is [lon, lat].
    const [lon, lat] = coords;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const { south, west, north, east } = site.bounds;
    if (lat < south || lat > north || lon < west || lon > east) continue;

    seen.add(localId);
    cams.push({
      id: `iteris${site.key}:${localId}`,
      // South Carolina's `name` is a bare device number, so the
      // description is preferred wherever both exist.
      title:
        nonEmpty(props.description) ??
        nonEmpty(props.cameras?.[0]?.description) ??
        nonEmpty(props.name) ??
        `${site.region} camera ${localId}`,
      place: nonEmpty(props.jurisdiction) ?? nonEmpty(props.route) ?? site.region,
      country: "United States",
      lat,
      lon,
      category: "traffic",
      prominence: 2,
      stillUrl,
      refreshSeconds: site.refreshSeconds,
      sourcePage: site.sourcePage,
      provider: site.label,
    });
  }

  return cams;
}

export const iterisSource: CamSource = {
  key: "iteris",
  label: "State 511 traffic cameras (Iteris platform)",
  async fetchCams() {
    const settled = await Promise.allSettled(SITES.map(fetchSite));
    const cams: Cam[] = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") cams.push(...result.value);
      else console.warn(`[cams] iteris ${SITES[index].state} failed:`, result.reason);
    }
    return cams;
  },
};
