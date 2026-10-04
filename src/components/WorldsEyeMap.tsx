"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { thumbSize } from "@/lib/cams/spatial";
import { thumbUrl, versionFor } from "@/lib/cams/display";
import type { PublicCam } from "@/lib/cams/types";
import { DEFAULT_VIEW, parseCamId, parseView, type ShareView } from "@/lib/share/view";
import { CamDetail } from "./CamDetail";
import { ShareDialog } from "./ShareDialog";
import { LayersControl, type Facet, type LayersState } from "./LayersControl";
import { MulticamDashboard, loadStoredDashboard, storeDashboard } from "./MulticamDashboard";
import { useDashboards } from "@/lib/useDashboards";
import { PublicGallery, type PublicWall } from "./PublicGallery";
import { WallBuilder, type RouteResult } from "./WallBuilder";
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

const NO_CAMS: PublicCam[] = [];

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
function FrameErrorHandler({ onFrameError }: { onFrameError: () => void }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const onError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const holder = target.closest(".wev-thumb-icon");
      if (holder instanceof HTMLElement) holder.style.display = "none";
      onFrameError();
    };

    container.addEventListener("error", onError, true);
    return () => container.removeEventListener("error", onError, true);
  }, [map, onFrameError]);

  return null;
}

interface ViewportState {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
  /** Centre of the view, which is what a shared link records. */
  lat: number;
  lon: number;
  /** How many cameras this size of map has room for. */
  limit: number;
}

/**
 * Cameras to ask for, from the size of the map on screen.
 *
 * A fixed number suits one screen size. The old 140 filled a laptop and
 * left a large monitor looking sparse, since the same 140 thumbnails were
 * spread over three times the area. One camera per 7,000 square pixels
 * gives the same density everywhere, about half of the grid's cells, so
 * there is always map visible between thumbnails. The ceiling keeps a
 * very large window from asking for more frames than is polite.
 */
function cameraBudget(map: L.Map): number {
  const size = map.getSize();
  return Math.min(260, Math.max(60, Math.round((size.x * size.y) / 7000)));
}

function readViewport(map: L.Map): ViewportState {
  const bounds = map.getBounds();
  // Wrapped, because panning round the world keeps counting past 180.
  const centre = map.getCenter().wrap();
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
    zoom: map.getZoom(),
    lat: centre.lat,
    lon: centre.lng,
    limit: cameraBudget(map),
  };
}

/**
 * Frames a newly-planned route.
 *
 * Without this the route is drawn wherever you happen to be looking,
 * which for a Tampa-to-Orlando search while viewing Finland means an
 * invisible result and an apparently broken feature.
 */
function RouteFitter({ result }: { result: RouteResult | null }) {
  const map = useMap();
  const lastFitted = useRef<string | null>(null);

  useEffect(() => {
    if (!result || result.route.path.length < 2) return;
    // Only fit once per route, or every background refresh would yank the
    // map back and fight the user panning along the road.
    const key = `${result.start.lat},${result.start.lon}->${result.end.lat},${result.end.lon}`;
    if (lastFitted.current === key) return;
    lastFitted.current = key;

    const bounds = L.latLngBounds(result.route.path.map((point) => [point.lat, point.lon] as [number, number]));
    map.fitBounds(bounds, { padding: [60, 60] });
  }, [result, map]);

  return null;
}

/**
 * Fixed stacking order for the tile overlays.
 *
 * Every TileLayer otherwise lands in Leaflet's single `tilePane`, where
 * stacking follows the order layers were *added* — not the order they
 * appear in the JSX. Because the overlays are toggled independently,
 * that order is whatever sequence the user happened to click, so radar
 * switched on after the labels would paint over them. Naming a pane per
 * overlay and giving it an explicit z-index makes the arrangement a
 * property of the map instead of an accident of the session:
 *
 *   200  tilePane      basemap (Leaflet's default)
 *   210  wev-radar     precipitation
 *   220  wev-reference roads and place names
 *   600  markerPane    camera thumbnails (Leaflet's default)
 *
 * So weather washes over the imagery, roads and names stay readable
 * through it, and no tile layer ever covers a camera.
 */
export const RADAR_PANE = "wev-radar";
export const REFERENCE_PANE = "wev-reference";

function MapPanes() {
  const map = useMap();
  useEffect(() => {
    for (const [name, zIndex] of [
      [RADAR_PANE, 210],
      [REFERENCE_PANE, 220],
    ] as const) {
      // createPane is idempotent by name, but setting the z-index is not
      // — Leaflet returns the existing element, so guard the assignment
      // to avoid clobbering it on a re-render.
      const pane = map.getPane(name) ?? map.createPane(name);
      if (pane.style.zIndex !== String(zIndex)) pane.style.zIndex = String(zIndex);
    }
  }, [map]);
  return null;
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
function UrlSync({ camId }: { camId: string | null }) {
  const map = useMap();

  const sync = useCallback(() => {
    // Wrapped for the same reason as readViewport: a link saying
    // lon=-442 is the same place as lon=-82 and reads as a bug.
    const center = map.getCenter().wrap();
    const params = new URLSearchParams(window.location.search);
    params.set("lat", center.lat.toFixed(4));
    params.set("lon", center.lng.toFixed(4));
    params.set("zoom", String(map.getZoom()));
    // The open camera rides along, so the address bar is always a link
    // to exactly what is on screen.
    if (camId) params.set("cam", camId);
    else params.delete("cam");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [map, camId]);

  useMapEvents({ moveend: sync, zoomend: sync });

  // Opening or closing a camera changes the link without the map moving.
  // Skipped on mount: a first visit to the bare address should stay bare
  // until the visitor actually does something.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    sync();
  }, [sync]);

  return null;
}

/** Reads ?lat=&lon=&zoom=. Safe at render time — this only loads with `ssr: false`. */
function initialView(): { center: [number, number]; zoom: number } {
  const fallback = { center: [DEFAULT_VIEW.lat, DEFAULT_VIEW.lon] as [number, number], zoom: DEFAULT_VIEW.zoom };
  if (typeof window === "undefined") return fallback;

  const params = new URLSearchParams(window.location.search);
  const view = parseView((key) => params.get(key));
  return view ? { center: [view.lat, view.lon], zoom: view.zoom } : fallback;
}

/** The camera a shared link asks to open, if it names one. */
function initialCamId(): string | null {
  if (typeof window === "undefined") return null;
  return parseCamId(new URLSearchParams(window.location.search).get("cam"));
}

/**
 * Which frame of each camera is on screen.
 *
 * A camera's frame address changes every couple of minutes so the browser
 * fetches a new picture. Swapping the address in directly meant Leaflet
 * replaced the thumbnail with an empty one that filled in when the frame
 * arrived, so somewhere on the map a tile was always blinking. Here the
 * new frame is fetched off screen first and the thumbnail changes only
 * once it has it, straight from one picture to the next.
 *
 * A frame that fails to load is switched to as well. The thumbnail's own
 * error handling then hides it, which is the right outcome for a camera
 * that has just gone down.
 */
function useSettledVersions(cams: PublicCam[], nowSeconds: number): (id: string) => number {
  const [settled, setSettled] = useState<Map<string, number>>(() => new Map());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    for (const cam of cams) {
      const target = versionFor(cam.id, nowSeconds);
      if (settled.get(cam.id) === target) continue;

      const key = `${cam.id}|${target}`;
      if (pending.current.has(key)) continue;
      pending.current.add(key);

      const done = () => {
        pending.current.delete(key);
        setSettled((current) => {
          // Rebuilt from scratch once it has grown well past what one
          // view holds, so a long session does not keep an entry for
          // every camera it ever passed over.
          const next = current.size > 3000 ? new Map<string, number>() : new Map(current);
          next.set(cam.id, target);
          return next;
        });
      };

      const probe = new Image();
      probe.onload = done;
      probe.onerror = done;
      probe.src = thumbUrl(cam.id, target);
    }
  }, [cams, nowSeconds, settled]);

  // A camera not seen before has nothing to hold on to, so it shows the
  // current frame directly; its probe above is the same request.
  return (id) => settled.get(id) ?? versionFor(id, nowSeconds);
}

export function WorldsEyeMap() {
  // Read once — afterwards the map owns the view and UrlSync writes back.
  const [{ center: initialCenter, zoom: initialZoom }] = useState(initialView);

  const [viewport, setViewport] = useState<ViewportState | null>(null);
  const [data, setData] = useState<CamsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PublicCam | null>(null);
  // The camera named by a shared link, until its details arrive. Held
  // separately so the address keeps naming it in the meantime.
  const [linkedCamId, setLinkedCamId] = useState<string | null>(initialCamId);
  const [sharing, setSharing] = useState<PublicCam | "view" | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [layers, setLayers] = useState<LayersState>({ categories: null, providers: null });
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  // Restored straight into the initial state rather than from an effect.
  // This component only ever loads with `ssr: false`, so localStorage is
  // already available on the first render and the wall doesn't flash
  // empty before filling in.
  const [mapLayers, setMapLayersState] = useState<MapLayersState>(loadMapLayers);
  const [radarTemplate, setRadarTemplate] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);

  const library = useDashboards();

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

  // A shared link can name a camera that did not win a thumbnail at this
  // zoom, so it is fetched by id rather than looked for in the viewport.
  useEffect(() => {
    if (!linkedCamId) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/cams/lookup?id=${encodeURIComponent(linkedCamId)}`);
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { cam: PublicCam };
        if (!cancelled) setSelected(payload.cam);
      } catch {
        // A camera that has left its feed: the link still opens the map
        // where it was, just without a panel.
      } finally {
        if (!cancelled) setLinkedCamId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [linkedCamId]);

  /**
   * Asks for the viewport again shortly after a thumbnail fails.
   *
   * A failed frame is hidden, which leaves a gap. By then the server has
   * recorded the failure and will give that slot to a working neighbour,
   * but only if asked, and nothing asked until the next pan. Failures
   * arrive in clusters, so they are gathered for a moment into a single
   * request, and capped per view so a region full of dead cameras cannot
   * turn into a polling loop.
   */
  const retriesLeft = useRef(2);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFrameError = useCallback(() => {
    if (retryTimer.current || retriesLeft.current <= 0) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      retriesLeft.current--;
      setRetryNonce((current) => current + 1);
    }, 2500);
  }, []);

  const onViewportChange = useCallback((next: ViewportState) => {
    retriesLeft.current = 2;
    setViewport(next);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    []
  );

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
        limit: String(viewport.limit),
      });
      // Only present on a retry after failed frames. Without it the
      // browser would answer from its own minute-long cache of this
      // exact request and the gaps would stay.
      if (retryNonce > 0) params.set("r", String(retryNonce));
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
  }, [viewport, categoryParam, providerParam, retryNonce]);

  // Drives the staggered thumbnail refresh. A 15s tick is fine-grained
  // enough that cameras come due steadily rather than in visible waves.
  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);

  // One stable empty list, so the effects that watch `cams` do not see a
  // new array on every render before the first response.
  const cams = data?.cams ?? NO_CAMS;
  const zoom = viewport?.zoom ?? initialZoom;
  const shownVersion = useSettledVersions(cams, nowSeconds);

  const shareView: ShareView | null = viewport
    ? {
        lat: viewport.lat,
        lon: viewport.lon,
        zoom: viewport.zoom,
        cam: sharing && sharing !== "view" ? sharing.id : null,
      }
    : null;

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
        <MapPanes />

        {/* Keyed so switching basemap swaps the layer rather than
            mutating the existing one's URL, which Leaflet handles badly. */}
        <TileLayer
          key={mapLayers.base}
          attribution={BASE_TILES[mapLayers.base].attribution}
          url={BASE_TILES[mapLayers.base].url}
          maxZoom={17}
        />
        {/* Panes fix the stacking regardless of which overlay was toggled
            on first — see MapPanes. */}
        {mapLayers.weather && radarTemplate && (
          <TileLayer
            key={radarTemplate}
            pane={RADAR_PANE}
            url={radarTemplate}
            // RainViewer's radar composite only has data to z7 — measured,
            // not assumed: every tile from z8 up is the same 1370-byte
            // blank PNG. Without maxNativeZoom Leaflet dutifully requested
            // those blanks and the radar simply disappeared the moment you
            // zoomed in far enough to actually see any cameras. Capping the
            // native level makes Leaflet upscale the z7 tile instead, so
            // the weather stays put all the way in. It goes soft at high
            // zoom, which is honest: that IS the resolution of the data.
            maxNativeZoom={7}
            maxZoom={17}
            // Lighter than the old flat 0.5. Radar is a full-frame wash,
            // and once you're zoomed into a city the point is the city,
            // not the rain over it.
            opacity={0.38}
            attribution="Radar &copy; RainViewer"
          />
        )}
        {mapLayers.roads && <TileLayer pane={REFERENCE_PANE} url={OVERLAY_TILES.roads} maxZoom={17} />}
        {mapLayers.places && <TileLayer pane={REFERENCE_PANE} url={OVERLAY_TILES.places} maxZoom={17} />}

        <ViewportWatcher onChange={onViewportChange} />
        <UrlSync camId={selected?.id ?? linkedCamId} />
        <FrameErrorHandler onFrameError={onFrameError} />
        <RouteFitter result={routeResult} />

        {routeResult && (
          <>
            {/* Drawn twice: a wide dark casing under a bright line, so the
                route stays readable over both pale desert and dark ocean. */}
            <Polyline
              positions={routeResult.route.path.map((p) => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: "#04202e", weight: 8, opacity: 0.75 }}
            />
            <Polyline
              positions={routeResult.route.path.map((p) => [p.lat, p.lon] as [number, number])}
              pathOptions={{ color: "#38bdf8", weight: 3.5, opacity: 0.95 }}
            />
          </>
        )}

        {cams.map((cam) => (
          <Marker
            key={cam.id}
            position={[cam.lat, cam.lon]}
            icon={iconFor(cam, zoom, shownVersion(cam.id), selected?.id === cam.id, wallIds.has(cam.id))}
            eventHandlers={{ click: () => setSelected(cam) }}
            zIndexOffset={Math.round(cam.prominence * 100)}
          />
        ))}
      </MapContainer>

      <div className="absolute inset-x-3 top-3 z-[1100] flex items-start justify-between gap-2">
        <StatusBar
          loading={loading}
          failed={failed}
          showing={cams.length}
          matching={data?.matching ?? 0}
          total={data?.total ?? 0}
        />

        {/* shrink-0: the controls keep their size and the status line
            gives up width instead, since a truncated count is readable
            and a squashed button is not. */}
        <div className="flex shrink-0 items-start gap-1.5">
          <WallBuilder
            routeResult={routeResult}
            onRouteResult={setRouteResult}
            onSendToWall={(cams) => {
              // Replaces rather than appends: each of these searches
              // produces a complete set — an itinerary, a neighbourhood, a
              // line of sunsets — and merging one into an unrelated wall
              // gives neither.
              updateWall(cams);
              setWallOpen(true);
            }}
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
            onClick={() => setSharing("view")}
            disabled={!viewport}
            aria-label="Share this view"
            title="Share this view"
            className="flex items-center gap-1.5 rounded-lg border border-wev-border bg-wev-panel/95 px-2 py-1.5 text-[11px] font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2 sm:gap-2 sm:px-2.5 sm:py-2 sm:text-xs"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-wev-accent sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3M8 7l4-4 4 4" />
              <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
            </svg>
            {/* The word is dropped on a phone, where this row has no width to spare. */}
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>

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

      <PublicGallery
        onOpen={(wall: PublicWall) => {
          // Loads like any other wall, and deliberately does NOT mark it
          // as the active saved dashboard: it belongs to someone else, so
          // later edits must not try to write back to their row.
          updateWall(wall.cams);
          library.setActiveId(null);
          setWallOpen(true);
        }}
      />

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
          onShare={() => setSharing(selected)}
          onClose={() => setSelected(null)}
        />
      )}

      {sharing && shareView && (
        <ShareDialog
          view={shareView}
          heading={sharing === "view" ? "Share this view" : `Share ${sharing.title}`}
          text={
            sharing === "view"
              ? "Live webcams on a satellite map, on World's Eye View"
              : `${sharing.title}, live on World's Eye View`
          }
          onClose={() => setSharing(null)}
        />
      )}

      {wallOpen && (
        <MulticamDashboard
          cams={wall}
          onRemove={(id) => updateWall(wall.filter((cam) => cam.id !== id))}
          onClear={() => updateWall([])}
          onReorder={updateWall}
          onClose={() => setWallOpen(false)}
          library={{
            signedIn: library.signedIn,
            dashboards: library.dashboards,
            activeId: library.activeId,
            // Loading a saved wall replaces the working wall, which also
            // writes it to localStorage — so it survives a sign-out.
            onLoad: (dashboard) => {
              updateWall(dashboard.cams);
              library.setActiveId(dashboard.id);
            },
            onCreate: library.create,
            onUpdate: library.update,
            onRename: (id, name) => library.update(id, { name }),
            onDelete: library.remove,
            onSetPublic: (id, isPublic) => library.update(id, { isPublic }),
            onMove: (id, folder) => library.update(id, { folder }),
          }}
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
    // A flex child of the top row, not positioned itself: min-w-0 lets it
    // shrink below its content width so the controls beside it always get
    // their full size, and the browser guarantees they never overlap -
    // which no hand-computed max-width can, since both the label and the
    // camera counts change independently.
    <div className="pointer-events-none min-w-0 truncate rounded-lg bg-black/70 px-2.5 py-1.5 text-[11px] leading-tight text-wev-text backdrop-blur-sm sm:px-3 sm:py-2 sm:text-xs">
      {failed ? (
        <span className="text-red-300">Couldn&apos;t reach the camera index — pan or zoom to retry.</span>
      ) : loading && total === 0 ? (
        <span>Loading cameras…</span>
      ) : (
        <>
          <span className="font-semibold text-white">{showing.toLocaleString()}</span>
          <span> shown</span>
          {matching > showing && <span className="text-wev-muted"> of {matching.toLocaleString()} here</span>}
          <span className="hidden text-wev-muted/70 sm:inline"> · {total.toLocaleString()} worldwide</span>
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
