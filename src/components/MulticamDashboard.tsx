"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import { thumbUrl, versionFor } from "@/lib/cams/display";

/**
 * A wall of cameras, built from whatever you've sent over from the map.
 *
 * The grid always aims at a rectangle rather than a single long row or
 * column: columns are the square root of the camera count rounded up, so
 * two cameras sit side by side, four make a 2x2, nine make a 3x3, and so
 * on. The panel's own width is capped at the viewport, which means adding
 * cameras past that point shrinks the tiles instead of pushing the panel
 * off screen — the wall gets denser rather than bigger, and removing
 * cameras lets it grow back.
 */

/** Ideal width of a single tile before the viewport cap starts shrinking them. */
const TILE_TARGET_PX = 340;

const STORAGE_KEY = "wev.dashboard.v1";

/** Columns for a near-square rectangle. 1->1, 2->2, 3->2, 4->2, 5->3, 9->3, 10->4. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
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

function DashboardTile({ cam, nowSeconds, onRemove }: { cam: PublicCam; nowSeconds: number; onRemove: () => void }) {
  const [failed, setFailed] = useState(false);
  const version = versionFor(cam.id, nowSeconds);

  return (
    <figure className="group relative overflow-hidden rounded-lg border border-wev-border bg-black">
      <div className="aspect-[4/3] w-full">
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
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4 text-[11px] text-white">
        {cam.title}
      </figcaption>

      <button
        type="button"
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

export function MulticamDashboard({
  cams,
  onRemove,
  onClear,
  onClose,
}: {
  cams: PublicCam[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const columns = useMemo(() => gridColumns(cams.length), [cams.length]);

  return (
    <div className="absolute inset-0 z-[1400] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        className="flex max-h-full flex-col overflow-hidden rounded-xl border border-wev-border bg-wev-panel shadow-2xl"
        style={{
          // Grow with the camera count, but never past the viewport — at
          // which point `1fr` columns shrink the tiles instead.
          width: `min(94vw, ${columns * TILE_TARGET_PX + (columns - 1) * 10 + 28}px)`,
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-wev-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-wev-text">
            Multicam
            <span className="ml-2 font-normal text-wev-muted">
              {cams.length} {cams.length === 1 ? "camera" : "cameras"} · {columns}&times;
              {Math.ceil(cams.length / columns)}
            </span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-1 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
            >
              Clear all
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

        <div className="overflow-auto p-3.5">
          {cams.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-wev-muted">
              No cameras yet. Click any camera on the map, then &ldquo;Add to multicam&rdquo;.
            </p>
          ) : (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {cams.map((cam) => (
                <DashboardTile
                  key={cam.id}
                  cam={cam}
                  nowSeconds={nowSeconds}
                  onRemove={() => onRemove(cam.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
