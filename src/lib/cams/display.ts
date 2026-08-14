import type { CamCategory } from "./types";

/**
 * Presentation helpers shared by the map, the detail panel and the
 * multicam dashboard.
 *
 * These live here rather than in a component because all three need them
 * and the components already reference each other — the map renders the
 * detail panel, the detail panel sends cameras to the dashboard. Hanging
 * the shared pieces off one of them would make an import cycle.
 */

export const CATEGORY_LABELS: Record<CamCategory, string> = {
  traffic: "Roads",
  volcano: "Volcanoes",
  observatory: "Observatories",
  airport: "Airports",
  space: "Spaceports",
  wildlife: "Wildlife",
  city: "Cities",
  harbor: "Coast & harbours",
  mountain: "Mountains",
  weather: "Weather",
};

/** How often a given frame is allowed to be refetched. */
export const REFRESH_WINDOW_SECONDS = 150;

/**
 * Spreads each camera's refresh across the refresh window so thumbnails
 * don't all reload on the same tick — which would flash the whole map at
 * once and stampede the proxy.
 */
function staggerOffset(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % REFRESH_WINDOW_SECONDS;
}

export function versionFor(id: string, nowSeconds: number): number {
  return Math.floor((nowSeconds + staggerOffset(id)) / REFRESH_WINDOW_SECONDS);
}

/**
 * `version` isn't read by the server — it exists to make the browser
 * fetch a genuinely new frame when one is due, rather than holding the
 * cached one until the element happens to remount.
 */
export function thumbUrl(id: string, version: number, size?: "full"): string {
  const params = new URLSearchParams({ id });
  if (size) params.set("size", size);
  params.set("v", String(version));
  return `/api/cams/thumb?${params.toString()}`;
}

export function formatCoordinate(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
}

export function formatCadence(refreshSeconds: number): string {
  return refreshSeconds < 120 ? `${refreshSeconds}s` : `${Math.round(refreshSeconds / 60)} min`;
}
