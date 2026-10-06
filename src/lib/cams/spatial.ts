import type { Cam } from "./types";

/**
 * The part that makes World's Eye View readable instead of a wall of
 * postage stamps.
 *
 * There are thousands of cameras. A viewport has room for a few dozen
 * thumbnails before it stops being a map and becomes a collage, so the
 * server decides who gets a slot: project every candidate into screen
 * pixels at the requested zoom, drop them into a grid whose cells are
 * thumbnail-sized, and keep only the most interesting camera in each
 * cell. Zooming in shrinks the ground each cell covers, so the freeway
 * cameras that lost to a volcano at country scale reappear on their own
 * once there's actually room for them.
 */

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const TILE_SIZE = 256;

/** Web Mercator's usable latitude range — the poles project to infinity. */
const MAX_LATITUDE = 85.05112878;

export interface PixelPoint {
  x: number;
  y: number;
}

/** Standard Web Mercator, matching what Leaflet uses to place the tiles underneath. */
export function project(lat: number, lon: number, zoom: number): PixelPoint {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/** The inverse of `project`: a pixel position at a zoom back to a coordinate. */
export function unproject(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / scale);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lat: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)), lon };
}

/**
 * Thumbnail edge length in pixels at a given zoom.
 *
 * Same idea as the situation-room maps: big enough to actually read at
 * country scale, but scaled down as you zoom out so they stay markers on
 * a map rather than tiles covering it. Prominence nudges the size so a
 * launch pad reads as more important than a freeway on-ramp without
 * needing a separate legend.
 */
export function thumbSize(zoom: number, prominence: number): number {
  const ANCHORS: [zoom: number, size: number][] = [
    [1, 34],
    [3, 40],
    [5, 50],
    [7, 62],
    [9, 76],
    [12, 92],
    [16, 108],
  ];

  let base = ANCHORS[ANCHORS.length - 1][1];
  if (zoom <= ANCHORS[0][0]) {
    base = ANCHORS[0][1];
  } else {
    for (let i = 0; i < ANCHORS.length - 1; i++) {
      const [z0, s0] = ANCHORS[i];
      const [z1, s1] = ANCHORS[i + 1];
      if (zoom <= z1) {
        base = s0 + ((s1 - s0) * (zoom - z0)) / (z1 - z0);
        break;
      }
    }
  }

  // 0.85x for the dullest camera up to ~1.25x for the marquee ones.
  const clamped = Math.min(10, Math.max(1, prominence));
  return Math.round(base * (0.85 + clamped * 0.04));
}

/** Handles bounding boxes that cross the antimeridian, which Alaska's Aleutian cameras really do. */
export function isWithin(box: BoundingBox, lat: number, lon: number): boolean {
  if (lat < box.south || lat > box.north) return false;
  return box.west <= box.east ? lon >= box.west && lon <= box.east : lon >= box.west || lon <= box.east;
}

/**
 * Prominence is the headline ranking, but a pure prominence sort makes
 * the map look dead in regions that only have traffic cameras — every
 * cell picks the same category. Categories that are inherently more
 * interesting to look at get a small nudge so a harbour or a volcano wins
 * a contested cell against a freeway, while thousands of equal-ranked
 * traffic cameras still fall back to a stable, deterministic tiebreak.
 */
const CATEGORY_BONUS: Record<Cam["category"], number> = {
  space: 2.5,
  volcano: 2,
  observatory: 2,
  wildlife: 1.5,
  harbor: 1,
  mountain: 1,
  airport: 0.75,
  city: 0.5,
  weather: 0.25,
  traffic: 0,
};

function score(cam: Cam): number {
  return cam.prominence + CATEGORY_BONUS[cam.category];
}

export interface ThinOptions {
  zoom: number;
  /** Cell size as a multiple of thumbnail size — >1 leaves visible map between thumbnails. */
  spacing?: number;
  /** Hard ceiling on returned cams, so a dense city view stays a sane payload. */
  limit?: number;
}

/**
 * Grid-thins candidates down to a set that can actually be laid out
 * without overlapping. Assumes `cams` is already filtered to the viewport.
 */
export function thinForViewport(cams: Cam[], options: ThinOptions): Cam[] {
  // 1.45 leaves close to half a thumbnail of map on each side of every
  // camera. 1.15 packed them edge to edge in a busy region and hid the
  // geography they were meant to be placed on.
  const { zoom, spacing = 1.45, limit = 140 } = options;

  // One representative size for the grid. Using each camera's own size
  // would make cell membership depend on which camera you asked about,
  // which isn't a grid any more.
  const cell = thumbSize(zoom, 5) * spacing;

  const best = new Map<string, Winner>();

  for (const cam of cams) {
    const point = project(cam.lat, cam.lon, zoom);
    const cx = Math.floor(point.x / cell);
    const cy = Math.floor(point.y / cell);
    const key = `${cx}:${cy}`;
    const camScore = score(cam);
    const held = best.get(key);

    // Deterministic tiebreak on id — without it, two equal-scoring cameras
    // would swap places between refreshes and the thumbnail would flicker.
    if (!held || beats(camScore, cam.id, held)) {
      best.set(key, { cam, score: camScore, cx, cy });
    }
  }

  const winners = [...best.values()];
  if (winners.length <= limit) {
    return winners.sort(byScoreThenSpread).map((entry) => entry.cam);
  }

  // More occupied cells than slots, which is the normal state of a
  // continental view. Cutting the list by score alone hands every slot to
  // the best-known cameras wherever they happen to cluster: the lower 48
  // at zoom 5 came back as 140 cameras from a single source, chosen by
  // how often each is viewed and not by where it is.
  //
  // So the slots are filled in two passes. First the winner of each
  // coarser block of cells, coarsening until those fit, which guarantees
  // every part of the view that has a camera shows one. Then whatever
  // room is left goes to the best of the rest. Blocks are whole multiples
  // of the fine grid and anchored to the world rather than the viewport,
  // so a block's winner is always one of the fine winners and panning
  // does not reshuffle who holds a slot.
  let spread: Winner[] = [];
  for (let block = 2; block <= 64; block *= 2) {
    const coarse = new Map<string, Winner>();
    for (const entry of winners) {
      const key = `${Math.floor(entry.cx / block)}:${Math.floor(entry.cy / block)}`;
      const held = coarse.get(key);
      if (!held || beats(entry.score, entry.cam.id, held)) coarse.set(key, entry);
    }
    if (coarse.size <= limit) {
      spread = [...coarse.values()];
      break;
    }
  }

  const taken = new Set(spread.map((entry) => entry.cam.id));
  const rest = winners.filter((entry) => !taken.has(entry.cam.id)).sort(byScoreThenSpread);
  return [...spread, ...rest.slice(0, limit - spread.length)].sort(byScoreThenSpread).map((entry) => entry.cam);
}

interface Winner {
  cam: Cam;
  score: number;
  cx: number;
  cy: number;
}

function beats(candidateScore: number, candidateId: string, held: Winner): boolean {
  return candidateScore > held.score || (candidateScore === held.score && candidateId < held.cam.id);
}

/** A stable pseudo-random number per camera id. */
function idHash(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * Best first, and equal scores in hash order rather than id order.
 *
 * Ids start with their source, so ordering ties alphabetically made the
 * cut-off geographic: every Florida camera sorted ahead of every Georgia
 * one. A hash is just as stable from one request to the next and has no
 * opinion about where a camera is.
 */
function byScoreThenSpread(a: Winner, b: Winner): number {
  return b.score - a.score || idHash(a.cam.id) - idHash(b.cam.id) || (a.cam.id < b.cam.id ? -1 : 1);
}
