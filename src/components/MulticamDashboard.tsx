"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import { thumbUrl, versionFor } from "@/lib/cams/display";
import { CamDetail } from "./CamDetail";
import { DashboardPicker } from "./DashboardPicker";
import type { SavedDashboard } from "@/lib/useDashboards";

/**
 * A wall of cameras, built from whatever you've sent over from the map.
 *
 * Layout defaults to a near-square rectangle — columns are the square
 * root of the camera count, rounded up — but you can override the column
 * count, which is how you reshape the wall into the rows and columns you
 * actually want. The panel's width is capped at the viewport, so adding
 * cameras past that point shrinks the tiles rather than pushing the panel
 * off screen.
 *
 * Tiles can be dragged to reorder. That's done with Pointer Events rather
 * than HTML5 drag-and-drop, because HTML5 dnd simply does not fire on
 * touch devices — and a camera wall is something you'd very plausibly
 * arrange on a tablet.
 */

/** Ideal width of a single tile before the viewport cap starts shrinking them. */
const TILE_TARGET_PX = 340;

/**
 * Narrowest a tile may get before we drop a column instead.
 *
 * The auto layout aims for a near-square grid, which is right on a
 * desktop and wrong on a phone: a 12-camera route wall becomes 4 columns
 * of ~80px tiles, too small to recognise anything in. Below this width a
 * column is removed and the wall simply gets taller — scrolling a column
 * of legible cameras beats seeing all twelve as thumbnails of nothing.
 */
const TILE_MIN_PX = 148;

const STORAGE_KEY = "wev.dashboard.v1";
const COLUMNS_KEY = "wev.dashboard.columns.v1";

/** Movement before a press becomes a drag — below this it's a tap/click. */
const DRAG_THRESHOLD_PX = 6;

/** Columns for a near-square rectangle. 1->1, 2->2, 3->2, 4->2, 5->3, 9->3, 10->4. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/**
 * How many columns actually fit across `availableWidth` at a legible size.
 *
 * Always at least 1: on a very narrow screen one under-sized column is
 * still better than a grid we refuse to draw.
 */
export function fittingColumns(availableWidth: number, gapPx: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 12;
  return Math.max(1, Math.floor((availableWidth + gapPx) / (TILE_MIN_PX + gapPx)));
}

export function loadStoredDashboard(): PublicCam[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Stored objects are whole cameras rather than ids, so the wall can
    // render immediately on load without waiting on a catalogue query.
    return Array.isArray(parsed) ? (parsed as PublicCam[]).filter((cam) => cam && typeof cam.id === "string") : [];
  } catch {
    return [];
  }
}

export function storeDashboard(cams: PublicCam[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cams));
  } catch {
    // Private-browsing quota errors aren't worth breaking the wall over.
  }
}

function loadStoredColumns(): number | null {
  if (typeof window === "undefined") return null;
  const raw = Number(window.localStorage.getItem(COLUMNS_KEY));
  return Number.isFinite(raw) && raw >= 1 && raw <= 12 ? raw : null;
}

function storeColumns(columns: number | null) {
  try {
    if (columns === null) window.localStorage.removeItem(COLUMNS_KEY);
    else window.localStorage.setItem(COLUMNS_KEY, String(columns));
  } catch {
    /* ignore */
  }
}

/** Moves an item, shifting everything between rather than swapping the two. */
function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function DashboardTile({
  cam,
  nowSeconds,
  onRemove,
  dragging,
  dropTarget,
  fill,
  onPointerDown,
}: {
  cam: PublicCam;
  nowSeconds: number;
  onRemove: () => void;
  dragging: boolean;
  dropTarget: boolean;
  /** Fullscreen: stretch to the grid cell instead of holding a 4:3 box. */
  fill: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  const [failed, setFailed] = useState(false);
  const version = versionFor(cam.id, nowSeconds);

  return (
    <figure
      data-tile
      onPointerDown={onPointerDown}
      className={`group relative overflow-hidden rounded-lg border bg-black transition-[opacity,transform] ${
        fill ? "h-full min-h-0" : ""
      } ${dragging ? "scale-[0.97] opacity-40" : "opacity-100"} ${
        dropTarget ? "border-sky-400" : "border-wev-border"
      }`}
      // Without this a touch-drag scrolls the panel instead of moving the tile.
      style={{ touchAction: "none" }}
    >
      <div className={fill ? "h-full w-full" : "aspect-[4/3] w-full"}>
        {failed ? (
          <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] text-wev-muted">
            Not responding
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- frames already come through our own resizing proxy
          <img
            key={version}
            src={thumbUrl(cam.id, version)}
            alt={cam.title}
            draggable={false}
            className="h-full w-full select-none object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4 text-[11px] text-white">
        {cam.title}
      </figcaption>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
        aria-label={`Remove ${cam.title}`}
        className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity hover:bg-black/90 focus:opacity-100 group-hover:opacity-100"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </figure>
  );
}

export interface DashboardLibrary {
  signedIn: boolean;
  dashboards: SavedDashboard[];
  activeId: number | null;
  onLoad: (dashboard: SavedDashboard) => void;
  onCreate: (name: string, cams: PublicCam[], columns: number | null, folder?: string) => Promise<unknown>;
  onUpdate: (id: number, patch: { cams?: PublicCam[]; columns?: number | null }) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  /** Publish or unpublish a wall. Public walls are readable by guests. */
  onSetPublic: (id: number, isPublic: boolean) => Promise<unknown>;
  /** Move a wall to a virtual folder path; "" is the root. */
  onMove: (id: number, folder: string) => Promise<unknown>;
}

export function MulticamDashboard({
  cams,
  onRemove,
  onClear,
  onReorder,
  onClose,
  library,
}: {
  cams: PublicCam[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onReorder: (cams: PublicCam[]) => void;
  onClose: () => void;
  library: DashboardLibrary;
}) {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [columnOverride, setColumnOverride] = useState<number | null>(loadStoredColumns);
  const [expanded, setExpanded] = useState(false);

  /** The tile being examined full-size, if any. */
  const [inspecting, setInspecting] = useState<PublicCam | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; index: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape backs out one level: leave fullscreen first, then close.
      if (inspecting) {
        setInspecting(null);
        return;
      }
      if (document.fullscreenElement) return;
      if (expanded) setExpanded(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, expanded, inspecting]);

  /**
   * Real fullscreen where it exists, CSS fullscreen everywhere else.
   *
   * iOS Safari refuses requestFullscreen on anything that isn't a <video>,
   * so the API alone would leave the feature simply not working on
   * iPhones. The `expanded` state does the actual layout work and is
   * enough on its own; the Fullscreen API is a bonus that additionally
   * hides the browser chrome where it's supported.
   */
  const toggleExpanded = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    try {
      if (next && panelRef.current?.requestFullscreen) {
        await panelRef.current.requestFullscreen().catch(() => {});
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
    } catch {
      // CSS fullscreen still applies — nothing to recover from.
    }
  }, [expanded]);

  // Leaving fullscreen via the browser's own control (Esc, the F11 key,
  // iOS's swipe) has to put our own state back in step.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setExpanded((current) => (current ? false : current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /**
   * The grid's own measured width, so the column cap reflects the box the
   * tiles actually live in rather than an assumption about the viewport.
   * A ResizeObserver catches phone rotation and desktop window drags
   * alike, and re-measures when entering or leaving fullscreen.
   */
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setGridWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cams.length, expanded]);

  const autoColumns = useMemo(() => gridColumns(cams.length), [cams.length]);
  const columns = Math.min(
    columnOverride ?? autoColumns,
    Math.max(1, cams.length),
    // Applies to the manual override too. Letting someone dial 6 columns
    // on a 390px phone would recreate the exact unreadable wall this cap
    // exists to prevent, and the -/+ readout below reports the capped
    // number so the control never disagrees with what's on screen.
    fittingColumns(gridWidth, 10)
  );
  const rows = Math.max(1, Math.ceil(cams.length / columns));
  /** Ceiling the -/+ control obeys, so it can't request a wall we won't draw. */
  const maxColumns = Math.min(12, Math.max(1, cams.length), fittingColumns(gridWidth, 10));

  const setColumns = useCallback((value: number | null) => {
    setColumnOverride(value);
    storeColumns(value);
  }, []);

  /** Which tile is under this point — the drop target while dragging. */
  const indexAtPoint = useCallback((x: number, y: number): number | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const tiles = [...grid.querySelectorAll("[data-tile]")];
    for (const [index, tile] of tiles.entries()) {
      const box = tile.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return index;
    }
    return null;
  }, []);

  const onTilePointerDown = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      // Left button / touch / pen only.
      if (event.button !== 0) return;
      dragOrigin.current = { x: event.clientX, y: event.clientY, index };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    []
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;

      // Only promote to a drag once the pointer has actually travelled —
      // otherwise every tap would be treated as a drag.
      if (dragIndex === null) {
        const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
        if (moved < DRAG_THRESHOLD_PX) return;
        setDragIndex(origin.index);
      }

      const target = indexAtPoint(event.clientX, event.clientY);
      setOverIndex(target);
    };

    const onUp = () => {
      const origin = dragOrigin.current;
      dragOrigin.current = null;
      if (dragIndex !== null && overIndex !== null && origin) {
        const next = reorder(cams, dragIndex, overIndex);
        if (next !== cams) onReorder(next);
      } else if (dragIndex === null && origin) {
        // Never crossed the drag threshold, so it was a tap rather than a
        // rearrange — the same gesture that opens a camera on the map.
        setInspecting(cams[origin.index] ?? null);
      }
      setDragIndex(null);
      setOverIndex(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [cams, dragIndex, overIndex, indexAtPoint, onReorder]);

  const shell = expanded
    ? "fixed inset-0 z-[1500] flex flex-col bg-wev-bg"
    : "absolute inset-0 z-[1400] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm";

  const panel = expanded
    ? "flex h-full w-full flex-col overflow-hidden bg-wev-bg"
    : "flex max-h-full flex-col overflow-hidden rounded-xl border border-wev-border bg-wev-panel shadow-2xl";

  return (
    <div className={shell}>
      <div
        ref={panelRef}
        className={panel}
        style={
          expanded
            ? undefined
            : {
                // Grow with the camera count, but never past the viewport —
                // at which point `1fr` columns shrink the tiles instead.
                width: `min(94vw, ${columns * TILE_TARGET_PX + (columns - 1) * 10 + 28}px)`,
              }
        }
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-wev-border px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="text-sm font-semibold text-wev-text">
              Multicam
              <span className="ml-2 font-normal text-wev-muted">
                {cams.length} {cams.length === 1 ? "camera" : "cameras"} · {columns}&times;{rows}
              </span>
            </h2>
            {library.signedIn && (
              <DashboardPicker
                dashboards={library.dashboards}
                activeId={library.activeId}
                currentCams={cams}
                currentColumns={columnOverride}
                onLoad={library.onLoad}
                onCreate={library.onCreate}
                onUpdate={library.onUpdate}
                onRename={library.onRename}
                onDelete={library.onDelete}
                onSetPublic={library.onSetPublic}
                onMove={library.onMove}
              />
            )}
          </div>

          <div className="flex items-center gap-1">
            <div className="mr-1 flex items-center gap-0.5 rounded border border-wev-border bg-wev-panel-2 px-1">
              <button
                type="button"
                onClick={() => setColumns(Math.max(1, columns - 1))}
                disabled={columns <= 1}
                aria-label="Fewer columns"
                className="px-1.5 py-0.5 text-sm text-wev-muted transition-colors hover:text-wev-text disabled:opacity-30"
              >
                &minus;
              </button>
              <span className="min-w-[3.6rem] text-center text-[11px] tabular-nums text-wev-muted">
                {columnOverride === null ? "auto" : `${columns} col`}
              </span>
              <button
                type="button"
                onClick={() => setColumns(Math.min(maxColumns, columns + 1))}
                disabled={columns >= maxColumns}
                aria-label="More columns"
                className="px-1.5 py-0.5 text-sm text-wev-muted transition-colors hover:text-wev-text disabled:opacity-30"
              >
                +
              </button>
            </div>
            {columnOverride !== null && (
              <button
                type="button"
                onClick={() => setColumns(null)}
                className="rounded px-2 py-1 text-[11px] text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
              >
                Auto
              </button>
            )}

            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={expanded ? "Exit fullscreen" : "Fullscreen"}
              title={expanded ? "Exit fullscreen" : "Fullscreen"}
              className="rounded p-1.5 text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
            >
              {expanded ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-1 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close multicam"
              className="rounded-full p-1 text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 p-2.5 sm:p-3.5 ${expanded ? "flex flex-col overflow-hidden" : "overflow-auto"}`}
        >
          {cams.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-wev-muted">
              No cameras yet. Click any camera on the map, then &ldquo;Add to multicam&rdquo;.
            </p>
          ) : (
            <div
              ref={gridRef}
              className={`grid gap-2 sm:gap-2.5 ${expanded ? "min-h-0 flex-1" : ""}`}
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                // Fullscreen is a video wall: the grid claims the whole
                // height and every row shares it equally, so six cameras
                // fill the screen instead of sitting in 4:3 boxes with
                // half the display empty beneath them.
                ...(expanded ? { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : {}),
              }}
            >
              {cams.map((cam, index) => (
                <DashboardTile
                  key={cam.id}
                  cam={cam}
                  nowSeconds={nowSeconds}
                  onRemove={() => onRemove(cam.id)}
                  dragging={dragIndex === index}
                  dropTarget={dragIndex !== null && overIndex === index && overIndex !== dragIndex}
                  fill={expanded}
                  onPointerDown={onTilePointerDown(index)}
                />
              ))}
            </div>
          )}

          {cams.length > 1 && !expanded && (
            <p className="px-1 pt-2.5 text-center text-[11px] text-wev-muted/70">
              Drag a camera to rearrange · use &minus;/+ to change columns
            </p>
          )}
        </div>
      </div>

      {/* Inside the shell on purpose: the shell establishes a stacking
          context, so CamDetail's z-index resolves against its siblings
          here and lands above the wall rather than behind it. */}
      {inspecting && (
        <CamDetail
          key={inspecting.id}
          cam={inspecting}
          inWall
          // Removing from here also closes the panel: leaving it open on
          // a camera that is no longer on the wall would offer actions
          // that no longer mean anything.
          onToggleWall={() => {
            onRemove(inspecting.id);
            setInspecting(null);
          }}
          onOpenWall={() => setInspecting(null)}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
