/**
 * Basemap and overlay choices for the map.
 *
 * Everything here is free and key-free. Esri's World Imagery, street map
 * and reference overlays need no token; RainViewer's radar needs none
 * either.
 *
 * Live traffic flow is the one obvious omission and it isn't an oversight:
 * every provider of it charges. Esri's World Traffic service answers
 * `{"error":{"code":499,"message":"Token Required"}}`, TomTom's flow tiles
 * 401 without a key and its free tier is 2,500 tiles/day — roughly 60-100
 * map views, which would break for real visitors almost immediately. So
 * "traffic" here means the road network, not congestion.
 */

export type BaseMap = "satellite" | "streets";

export interface MapLayersState {
  base: BaseMap;
  /** Road/rail network overlay. */
  roads: boolean;
  /** Place names and boundaries. */
  places: boolean;
  /** Precipitation radar. */
  weather: boolean;
}

export const DEFAULT_MAP_LAYERS: MapLayersState = {
  base: "satellite",
  roads: false,
  // On by default — without labels a satellite map is beautiful and
  // useless for finding anywhere.
  places: true,
  weather: false,
};

const STORAGE_KEY = "wev.maplayers.v1";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export const BASE_TILES: Record<BaseMap, { url: string; attribution: string }> = {
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  streets: {
    url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Tiles &copy; Esri — Source: Esri, HERE, Garmin, USGS, NGA",
  },
};

export const OVERLAY_TILES = {
  roads: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
  places: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
};

export function loadMapLayers(): MapLayersState {
  if (typeof window === "undefined") return DEFAULT_MAP_LAYERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MAP_LAYERS;
    const parsed = JSON.parse(raw) as Partial<MapLayersState>;
    return {
      base: parsed.base === "streets" ? "streets" : "satellite",
      roads: parsed.roads === true,
      places: parsed.places !== false,
      weather: parsed.weather === true,
    };
  } catch {
    return DEFAULT_MAP_LAYERS;
  }
}

export function storeMapLayers(state: MapLayersState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private browsing */
  }
}
