/**
 * A shareable map view: where the map is centred, how far in, and
 * optionally which camera is open.
 *
 * Shared by the browser (which writes these into the address bar and the
 * share links) and the server (which reads them to build the link preview
 * and its image), so both ends agree on what a given link means.
 */

export interface ShareView {
  lat: number;
  lon: number;
  zoom: number;
  /** Camera id, when the link points at one camera rather than an area. */
  cam: string | null;
}

/** Opens over the Atlantic, showing both North America and Europe. */
export const DEFAULT_VIEW: ShareView = { lat: 40, lon: -50, zoom: 3, cam: null };

/** Link-preview picture size, the 1.91:1 shape LinkedIn, Facebook and X all crop to. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 17;

type Getter = (key: string) => string | null | undefined;

/**
 * Camera ids are `<source>:<localId>`. The local part is whatever the
 * feed uses, so this only rules out what could never be one: whitespace,
 * markup characters, and anything long enough to be something else.
 */
const CAM_ID = /^[A-Za-z0-9]+:[^\s<>"'`\\]{1,120}$/;

export function parseCamId(raw: string | null | undefined): string | null {
  return raw && CAM_ID.test(raw) ? raw : null;
}

/**
 * Reads lat, lon and zoom. Returns null unless all three are present and
 * sane, so a half-written link falls back to the default view instead of
 * opening somewhere arbitrary.
 */
export function parseView(get: Getter): ShareView | null {
  const read = (key: string) => {
    const raw = get(key);
    if (raw === null || raw === undefined || raw.trim() === "") return NaN;
    return Number(raw);
  };

  const lat = read("lat");
  const lon = read("lon");
  const zoom = read("zoom");

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(zoom)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;

  return { lat, lon, zoom: Math.round(zoom), cam: parseCamId(get("cam")) };
}

/** The query string for a view, in one fixed order so equal views give equal links. */
export function viewQuery(view: ShareView): string {
  const params = new URLSearchParams({
    lat: view.lat.toFixed(4),
    lon: view.lon.toFixed(4),
    zoom: String(view.zoom),
  });
  if (view.cam) params.set("cam", view.cam);
  return params.toString();
}

/**
 * Snaps a view to a grid coarse enough that neighbouring links share one
 * preview image.
 *
 * The preview is expensive to draw and is cached by its address. Two
 * people sharing the same city from positions a few metres apart should
 * hit the same cached picture, and a script walking coordinates should
 * not be able to mint an unlimited number of distinct renders. The grid
 * tightens with zoom so the snap never moves the picture by more than a
 * few pixels.
 */
export function snapForPreview(view: ShareView): ShareView {
  const decimals = view.zoom <= 5 ? 1 : view.zoom <= 9 ? 2 : view.zoom <= 13 ? 3 : 4;
  const factor = 10 ** decimals;
  const snap = (value: number) => Math.round(value * factor) / factor;
  return { ...view, lat: snap(view.lat), lon: snap(view.lon) };
}

/** Address of the preview image for a view. Relative, so it works on any host. */
export function previewImagePath(view: ShareView): string {
  return `/api/og?${viewQuery(snapForPreview(view))}`;
}
