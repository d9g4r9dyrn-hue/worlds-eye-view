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
  const { zoom, spacing = 1.15, limit = 140 } = options;

  // One representative size for the grid. Using each camera's own size
  // would make cell membership depend on which camera you asked about,
  // which isn't a grid any more.
  const cell = thumbSize(zoom, 5) * spacing;

  const best = new Map<string, { cam: Cam; score: number }>();

  for (const cam of cams) {
    const point = project(cam.lat, cam.lon, zoom);
    const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
    const camScore = score(cam);
    const held = best.get(key);

    // Deterministic tiebreak on id — without it, two equal-scoring cameras
    // would swap places between refreshes and the thumbnail would flicker.
    if (!held || camScore > held.score || (camScore === held.score && cam.id < held.cam.id)) {
      best.set(key, { cam, score: camScore });
    }
  }

  const winners = [...best.values()].sort((a, b) => b.score - a.score || (a.cam.id < b.cam.id ? -1 : 1));
  return winners.slice(0, limit).map((entry) => entry.cam);
}
