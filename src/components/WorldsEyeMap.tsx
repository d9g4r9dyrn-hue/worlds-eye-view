"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { thumbSize } from "@/lib/cams/spatial";
import { thumbUrl, versionFor } from "@/lib/cams/display";
import type { PublicCam } from "@/lib/cams/types";
import { CamDetail } from "./CamDetail";
import { LayersControl, type Facet, type LayersState } from "./LayersControl";
import { MulticamDashboard, loadStoredDashboard, storeDashboard } from "./MulticamDashboard";
import {
  BASE_TILES,
  OVERLAY_TILES,
  loadMapLayers,
  storeMapLayers,
  type MapLayersState,
} from "@/lib/cams/mapLayers";

/**
 * World's Eye View — public webcams quilted onto a satellite map.
 *
 * Thumbnails scale with zoom so they stay legible at country scale
 * without tiling over the map, and the server has already thinned the set
 * so only one camera occupies any given patch of screen.
 */

export interface CamsResponse {
  cams: PublicCam[];
  matching: number;
  inView: number;
  total: number;
  facets: { categories: Facet[]; providers: Facet[] };
  sources: { key: string; label: string; count: number; fetchedAt: number; error: string | null }[];
}

/** Camera frames are 4:3-ish almost everywhere, so the tile matches. */
const THUMB_ASPECT = 0.72;

const ICON_CACHE = new Map<string, L.DivIcon>();

function iconFor(cam: PublicCam, zoom: number, version: number, selected: boolean, inWall: boolean): L.DivIcon {
  const width = thumbSize(zoom, cam.prominence);
  const height = Math.round(width * THUMB_ASPECT);
  const key = `${cam.id}|${width}|${version}|${selected ? 1 : 0}|${inWall ? 1 : 0}`;

  const cached = ICON_CACHE.get(key);
  if (cached) return cached;

  const classes = ["wev-thumb", selected && "wev-thumb--selected", inWall && "wev-thumb--pinned"]
    .filter(Boolean)
    .join(" ");

  // Built as markup rather than React because Leaflet owns this DOM.
  // Image failures are caught by a single delegated listener on the map
  // (see FrameErrorHandler) instead of an inline onerror attribute.
  const html = `
    <div class="${classes}" style="width:${width}px;height:${height}px">
      <img src="${thumbUrl(cam.id, version)}" alt="" loading="lazy" decoding="async" draggable="false" />
      <span class="wev-thumb__ring"></span>
    </div>
  `;

  const icon = L.divIcon({
    html,
    className: "wev-thumb-icon",
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  });

  // Unbounded growth would be a slow leak on a long-lived map session.
  if (ICON_CACHE.size > 4000) ICON_CACHE.clear();
  ICON_CACHE.set(key, icon);
  return icon;
}

/**
 * A camera that's offline, decommissioned or simply broken is completely
 * normal in these feeds. `error` doesn't bubble, but it does capture, so
 * one listener on the map container catches every failed frame and
 * quietly removes it rather than leaving a broken-image glyph.
 */
function FrameErrorHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const onError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const holder = target.closest(".wev-thumb-icon");
      if (holder instanceof HTMLElement) holder.style.display = "none";
    };

    container.addEventListener("error", onError, true);
    return () => container.removeEventListener("error", onError, true);
  }, [map]);

  return null;
}

interface ViewportState {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
}

function readViewport(map: L.Map): ViewportState {
  const bounds = map.getBounds();
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
    zoom: map.getZoom(),
  };
}

/** Reports the viewport after the user stops moving, so a drag is one request rather than sixty. */
function ViewportWatcher({ onChange }: { onChange: (viewport: ViewportState) => void }) {
  const map = useMap();

  useEffect(() => {
    onChange(readViewport(map));
    // Only on mount — subsequent updates come from the map events below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMapEvents({
    moveend: () => onChange(readViewport(map)),
    zoomend: () => onChange(readViewport(map)),
  });

  return null;
}

/**
 * Keeps the address bar pointing at wherever you've panned to, so a view
 * worth showing someone is just a link. replaceState rather than the App
 * Router: this fires on every pan, and routing it would mean a server
 * round-trip per map movement for a page that doesn't depend on the URL.
 */
function UrlSync() {
  const map = useMap();

  const sync = useCallback(() => {
    const center = map.getCenter();
    const params = new URLSearchParams(window.location.search);
    params.set("lat", center.lat.toFixed(4));
    params.set("lon", center.lng.toFixed(4));
    params.set("zoom", String(map.getZoom()));
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [map]);

  useMapEvents({ moveend: sync, zoomend: sync });
  return null;
}

/** Opens over the Atlantic, showing both North America and Europe. */
const DEFAULT_VIEW: { center: [number, number]; zoom: number } = { center: [40, -50], zoom: 3 };

/** Reads ?lat=&lon=&zoom=. Safe at render time — this only loads with `ssr: false`. */
function initialView(): { center: [number, number]; zoom: number } {
  if (typeof window === "undefined") return DEFAULT_VIEW;

  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const zoom = Number(params.get("zoom"));

  const hasCenter = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    center: hasCenter ? [lat, lon] : DEFAULT_VIEW.center,
    zoom: Number.isFinite(zoom) && zoom >= 2 && zoom <= 17 ? zoom : DEFAULT_VIEW.zoom,
  };
}

export function WorldsEyeMap() {
  // Read once — afterwards the map owns the view and UrlSync writes back.
  const [{ center: initialCenter, zoom: initialZoom }] = useState(initialView);

  const [viewport, setViewport] = useState<ViewportState | null>(null);
  const [data, setData] = useState<CamsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PublicCam | null>(null);
  const [layers, setLayers] = useState<LayersState>({ categories: null, providers: null });
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  // Restored straight into the initial state rather than from an effect.
  // This component only ever loads with `ssr: false`, so localStorage is
  // already available on the first render and the wall doesn't flash
  // empty before filling in.
  const [mapLayers, setMapLayersState] = useState<MapLayersState>(loadMapLayers);
  const [radarTemplate, setRadarTemplate] = useState<string | null>(null);

  const [wall, setWall] = useState<PublicCam[]>(loadStoredDashboard);
  const [wallOpen, setWallOpen] = useState(false);

  const wallIds = useMemo(() => new Set(wall.map((cam) => cam.id)), [wall]);

  const updateWall = useCallback((next: PublicCam[]) => {
    setWall(next);
    storeDashboard(next);
  }, []);

  const setMapLayers = useCallback((next: MapLayersState) => {
    setMapLayersState(next);
    storeMapLayers(next);
  }, []);

  // The radar frame path changes roughly every ten minutes, so the tile
  // template has to be refreshed rather than hard-coded. Only fetched
  // while the layer is actually switched on.
  useEffect(() => {
    if (!mapLayers.weather) return;

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/weather/radar");
        const payload = (await response.json()) as { urlTemplate: string | null };
        if (!cancelled) setRadarTemplate(payload.urlTemplate);
      } catch {
        if (!cancelled) setRadarTemplate(null);
      }
    };

    void load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mapLayers.weather]);

  // Guards against a slow response for an old viewport landing after a
  // fast one for the current viewport and overwriting it.
  const requestSeq = useRef(0);

  const categoryParam = layers.categories ? [...layers.categories].sort().join(",") : null;
  const providerParam = layers.providers ? [...layers.providers].sort().join(",") : null;

  useEffect(() => {
    if (!viewport) return;

    const controller = new AbortController();
    const seq = ++requestSeq.current;

    // Debounced: a zoom-then-pan in quick succession shouldn't cost two
    // catalogue queries.
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({
        south: viewport.south.toFixed(5),
        west: viewport.west.toFixed(5),
        north: viewport.north.toFixed(5),
        east: viewport.east.toFixed(5),
        zoom: String(viewport.zoom),
      });
      // Sent only when a filter is active — an absent parameter means
      // "everything", which keeps the common request cacheable.
      if (categoryParam !== null) params.set("categories", categoryParam);
      if (providerParam !== null) params.set("providers", providerParam);

      try {
        const response = await fetch(`/api/cams?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`/api/cams responded ${response.status}`);
        const payload = (await response.json()) as CamsResponse;
        if (seq !== requestSeq.current) return;
        setData(payload);
        setFailed(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[cams] viewport query failed:", error);
        if (seq === requestSeq.current) setFailed(true);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [viewport, categoryParam, providerParam]);

  // Drives the staggered thumbnail refresh. A 15s tick is fine-grained
  // enough that cameras come due steadily rather than in visible waves.
  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);

  const cams = data?.cams ?? [];
  const zoom = viewport?.zoom ?? initialZoom;

  return (
    <div className="relative h-full w-full">
      <style>{THUMB_STYLES}</style>

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        minZoom={2}
        maxZoom={17}
        zoomControl={false}
        worldCopyJump
        className="h-full w-full"
      >
        <ZoomControl position="bottomright" />

        {/* Keyed so switching basemap swaps the layer rather than
            mutating the existing one's URL, which Leaflet handles badly. */}
        <TileLayer
          key={mapLayers.base}
          attribution={BASE_TILES[mapLayers.base].attribution}
          url={BASE_TILES[mapLayers.base].url}
          maxZoom={17}
        />
        {mapLayers.roads && <TileLayer url={OVERLAY_TILES.roads} maxZoom={17} />}
        {mapLayers.places && <TileLayer url={OVERLAY_TILES.places} maxZoom={17} />}
        {mapLayers.weather && radarTemplate && (
          <TileLayer
            key={radarTemplate}
            url={radarTemplate}
            // Radar is a wash of colour over the whole frame; at full
            // strength it buries both the terrain and the thumbnails.
            opacity={0.5}
            attribution="Radar &copy; RainViewer"
            maxZoom={17}
          />
        )}

        <ViewportWatcher onChange={setViewport} />
        <UrlSync />
        <FrameErrorHandler />

        {cams.map((cam) => (
          <Marker
            key={cam.id}
            position={[cam.lat, cam.lon]}
            icon={iconFor(cam, zoom, versionFor(cam.id, nowSeconds), selected?.id === cam.id, wallIds.has(cam.id))}
            eventHandlers={{ click: () => setSelected(cam) }}
            zIndexOffset={Math.round(cam.prominence * 100)}
          />
        ))}
      </MapContainer>

      <StatusBar
        loading={loading}
        failed={failed}
        showing={cams.length}
        matching={data?.matching ?? 0}
        total={data?.total ?? 0}
      />

      {data && (
        <LayersControl
          categoryFacets={data.facets.categories}
          providerFacets={data.facets.providers}
          state={layers}
          onChange={setLayers}
          mapLayers={mapLayers}
          onMapLayersChange={setMapLayers}
        />
      )}

      <button
        type="button"
        onClick={() => setWallOpen(true)}
        className="absolute bottom-3 left-3 z-[1100] flex items-center gap-2 rounded-lg border border-wev-border bg-wev-panel/95 px-3 py-2 text-xs font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-wev-accent" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="4" width="7.5" height="7" rx="1" />
          <rect x="13.5" y="4" width="7.5" height="7" rx="1" />
          <rect x="3" y="13" width="7.5" height="7" rx="1" />
          <rect x="13.5" y="13" width="7.5" height="7" rx="1" />
        </svg>
        Multicam
        {wall.length > 0 && (
          <span className="rounded-full bg-sky-400/20 px-1.5 py-0.5 text-[10px] tabular-nums text-wev-accent">
            {wall.length}
          </span>
        )}
      </button>

      {/* Keyed on the camera so switching selection remounts the panel —
          see CamDetail for why it resets that way rather than in an effect. */}
      {selected && (
        <CamDetail
          key={selected.id}
          cam={selected}
          inWall={wallIds.has(selected.id)}
          onToggleWall={() =>
            updateWall(
              wallIds.has(selected.id) ? wall.filter((cam) => cam.id !== selected.id) : [...wall, selected]
            )
          }
          onOpenWall={() => setWallOpen(true)}
          onClose={() => setSelected(null)}
        />
      )}

      {wallOpen && (
        <MulticamDashboard
          cams={wall}
          onRemove={(id) => updateWall(wall.filter((cam) => cam.id !== id))}
          onClear={() => updateWall([])}
          onReorder={updateWall}
          onClose={() => setWallOpen(false)}
        />
      )}
    </div>
  );
}

function StatusBar({
  loading,
  failed,
  showing,
  matching,
  total,
}: {
  loading: boolean;
  failed: boolean;
  showing: number;
  matching: number;
  total: number;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-lg bg-black/70 px-3 py-2 text-[11px] leading-tight text-wev-text backdrop-blur-sm sm:text-xs">
      {failed ? (
        <span className="text-red-300">Couldn&apos;t reach the camera index — pan or zoom to retry.</span>
      ) : loading && total === 0 ? (
        <span>Loading cameras…</span>
      ) : (
        <>
          <span className="font-semibold text-white">{showing.toLocaleString()}</span>
          <span> shown</span>
          {matching > showing && <span className="text-wev-muted"> of {matching.toLocaleString()} here</span>}
          <span className="text-wev-muted/70"> · {total.toLocaleString()} worldwide</span>
          {loading && <span className="text-wev-muted/70"> · updating…</span>}
        </>
      )}
    </div>
  );
}

/**
 * Scoped here rather than in globals.css — nothing else renders camera
 * thumbnails, and keeping it next to iconFor means the markup and the
 * styling it depends on stay together.
 */
const THUMB_STYLES = `
.wev-thumb-icon { background: none; border: none; }
.wev-thumb {
  position: relative;
  overflow: hidden;
  border-radius: 5px;
  box-shadow: 0 2px 10px rgba(0,0,0,.55);
  cursor: pointer;
  transition: transform .14s ease, box-shadow .14s ease;
}
.wev-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* Frames arrive at wildly different exposures; a touch of contrast
     keeps a washed-out daytime camera from looking blown out next to a
     dark one, without flattening the day/night difference that makes the
     map worth looking at. */
  filter: saturate(1.05) contrast(1.04);
}
.wev-thumb__ring {
  position: absolute;
  inset: 0;
  border-radius: 5px;
  /* Inset rather than a real border so the ring never changes layout size. */
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.32);
  pointer-events: none;
}
.wev-thumb:hover { transform: scale(1.06); box-shadow: 0 4px 16px rgba(0,0,0,.7); z-index: 500; }
.wev-thumb--selected .wev-thumb__ring { box-shadow: inset 0 0 0 2px rgb(56,189,248); }
.wev-thumb--pinned .wev-thumb__ring { box-shadow: inset 0 0 0 2px rgb(74,222,128); }
`;
