import type { Cam } from "../cams/types";

/**
 * Picking the cameras that actually sit along a route.
 *
 * The job is narrower than "cameras near a line": each one also needs a
 * position *along* the route, so the wall can be ordered the way you'd
 * drive it rather than by whatever order the catalogue happened to be in.
 * Watching a journey out of order would be worse than useless.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteCam {
  cam: Cam;
  /** Metres from the route line. */
  offsetMeters: number;
  /** Metres travelled along the route before reaching this camera's nearest point. */
  alongMeters: number;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Equirectangular approximation rather than haversine.
 *
 * Distances here are at most a few kilometres (a corridor width), where
 * the error against haversine is centimetres, and this runs tens of
 * millions of times across a long route. Latitude scaling keeps it honest
 * as you move away from the equator.
 */
function metersBetween(a: LatLon, b: LatLon, cosLat: number): number {
  const dx = (b.lon - a.lon) * (Math.PI / 180) * EARTH_RADIUS_M * cosLat;
  const dy = (b.lat - a.lat) * (Math.PI / 180) * EARTH_RADIUS_M;
  return Math.hypot(dx, dy);
}

/**
 * Distance from a point to a segment, plus how far along that segment the
 * closest approach falls (0..1).
 *
 * Segment distance rather than vertex distance matters on motorways: OSRM
 * can leave a kilometre between vertices on a long straight, and a
 * vertex-only test would miss cameras sitting mid-span.
 */
function pointToSegment(
  point: LatLon,
  start: LatLon,
  end: LatLon,
  cosLat: number
): { distance: number; t: number } {
  const toMeters = (from: LatLon, to: LatLon) => ({
    x: (to.lon - from.lon) * (Math.PI / 180) * EARTH_RADIUS_M * cosLat,
    y: (to.lat - from.lat) * (Math.PI / 180) * EARTH_RADIUS_M,
  });

  const seg = toMeters(start, end);
  const pt = toMeters(start, point);
  const lengthSquared = seg.x * seg.x + seg.y * seg.y;

  if (lengthSquared === 0) return { distance: Math.hypot(pt.x, pt.y), t: 0 };

  // Clamped projection: a camera beyond either end of the segment is
  // measured to that endpoint, not to an imaginary extension of the line.
  const t = Math.max(0, Math.min(1, (pt.x * seg.x + pt.y * seg.y) / lengthSquared));
  const projX = seg.x * t;
  const projY = seg.y * t;
  return { distance: Math.hypot(pt.x - projX, pt.y - projY), t };
}

export interface CorridorOptions {
  /** How far from the road a camera may sit and still count. */
  corridorMeters: number;
}

/**
 * Finds every camera within `corridorMeters` of the route, ordered from
 * start to finish. Thinning is a separate step (`summarise`) so callers
 * can report how many were found before deciding how many to show —
 * running the search twice to get both numbers would double the work.
 *
 * ## Why it's fast enough
 *
 * A 135km route is ~950 vertices and the catalogue is ~30,000 cameras, so
 * the naive comparison is 28 million segment tests per query. Instead the
 * route's vertices are dropped into a grid whose cells are corridor-sized,
 * and each camera only tests segments in its own cell and the eight
 * around it. That turns the search into roughly O(cameras) with a small
 * constant, and a cross-country route stays comfortably interactive.
 */
export function camerasAlongRoute(cams: Cam[], path: LatLon[], options: CorridorOptions): RouteCam[] {
  if (path.length < 2) return [];

  const { corridorMeters } = options;

  // Cumulative distance to each vertex, so a camera's along-route
  // position is a lookup plus the fraction into its own segment.
  const midLat = path[Math.floor(path.length / 2)].lat;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const cumulative = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) {
    cumulative[i] = cumulative[i - 1] + metersBetween(path[i - 1], path[i], cosLat);
  }

  // Grid over the route, cells roughly the corridor width so a camera
  // only ever needs its own cell plus neighbours.
  const cellDegrees = Math.max(0.005, corridorMeters / 111_320);
  const cellKey = (lat: number, lon: number) =>
    `${Math.floor(lat / cellDegrees)}:${Math.floor(lon / cellDegrees)}`;

  const grid = new Map<string, number[]>();
  for (let i = 0; i < path.length - 1; i++) {
    // Register the segment under both endpoints' cells so a segment
    // spanning a boundary is found from either side.
    for (const point of [path[i], path[i + 1]]) {
      const key = cellKey(point.lat, point.lon);
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, (bucket = []));
      if (bucket[bucket.length - 1] !== i) bucket.push(i);
    }
  }

  // Bounding box with corridor padding — rejects the ~29,000 cameras that
  // are nowhere near this route before any real work happens.
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of path) {
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
  }
  const padLat = corridorMeters / 111_320;
  const padLon = padLat / Math.max(0.2, cosLat);

  const found: RouteCam[] = [];

  for (const cam of cams) {
    if (cam.lat < south - padLat || cam.lat > north + padLat) continue;
    if (cam.lon < west - padLon || cam.lon > east + padLon) continue;

    const baseRow = Math.floor(cam.lat / cellDegrees);
    const baseCol = Math.floor(cam.lon / cellDegrees);

    let best: { distance: number; along: number } | null = null;

    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        const bucket = grid.get(`${baseRow + dRow}:${baseCol + dCol}`);
        if (!bucket) continue;

        for (const segment of bucket) {
          const { distance, t } = pointToSegment(cam, path[segment], path[segment + 1], cosLat);
          if (distance > corridorMeters) continue;
          if (best && distance >= best.distance) continue;

          const segmentLength = cumulative[segment + 1] - cumulative[segment];
          best = { distance, along: cumulative[segment] + segmentLength * t };
        }
      }
    }

    if (best) found.push({ cam, offsetMeters: best.distance, alongMeters: best.along });
  }

  found.sort((a, b) => a.alongMeters - b.alongMeters);
  return found;
}

/**
 * Thins an ordered list to at most `max`, spread evenly by distance
 * travelled rather than by list position.
 *
 * Spacing by distance is the whole point: cameras bunch up in cities, so
 * taking every Nth item on a Tampa-to-Orlando drive would return forty
 * views of Tampa and nothing of the highway. Picking the camera nearest
 * each evenly-spaced milestone gives a walk-through of the journey.
 *
 * The first and last are always kept — they're the start and the
 * destination, which are the two anyone actually asked about.
 */
export function summarise(ordered: RouteCam[], max: number): RouteCam[] {
  if (max <= 0 || ordered.length <= max) return ordered;
  if (max === 1) return [ordered[0]];

  const total = ordered[ordered.length - 1].alongMeters;
  const picked: RouteCam[] = [];
  const used = new Set<number>();

  for (let i = 0; i < max; i++) {
    const target = (total * i) / (max - 1);

    // Nearest unused camera to this milestone.
    let bestIndex = -1;
    let bestGap = Infinity;
    for (let j = 0; j < ordered.length; j++) {
      if (used.has(j)) continue;
      const gap = Math.abs(ordered[j].alongMeters - target);
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = j;
      }
    }

    if (bestIndex >= 0) {
      used.add(bestIndex);
      picked.push(ordered[bestIndex]);
    }
  }

  picked.sort((a, b) => a.alongMeters - b.alongMeters);
  return picked;
}
