"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import { thumbUrl, versionFor } from "@/lib/cams/display";

/**
 * Walls other people have published.
 *
 * The one part of the dashboard feature that works without an account —
 * a guest can browse and open any of these, and can't change or publish
 * anything, which is enforced by the API having no write route rather
 * than by a check here.
 *
 * Opening one loads it into the multicam exactly as your own saved wall
 * would, so a published wall is a real starting point rather than a
 * read-only preview: you can drop cameras, add your own, and (if signed
 * in) save the result as yours without touching the original.
 */

export interface PublicWall {
  id: number;
  name: string;
  cams: PublicCam[];
  columns: number | null;
  publishedAt: string | null;
  author: string | null;
}

/** A few frames from the wall, as a sense of what's inside it. */
function Strip({ cams, nowSeconds }: { cams: PublicCam[]; nowSeconds: number }) {
  const preview = cams.slice(0, 4);
  if (preview.length === 0) return null;

  return (
    <div className="mt-1.5 flex gap-1">
      {preview.map((cam) => (
        // eslint-disable-next-line @next/next/no-img-element -- frames come through our own resizing proxy
        <img
          key={cam.id}
          src={thumbUrl(cam.id, versionFor(cam.id, nowSeconds))}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-10 w-1/4 rounded border border-wev-border bg-black object-cover"
          // A dead camera in a preview strip is noise, not information.
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      ))}
    </div>
  );
}

export function PublicGallery({ onOpen }: { onOpen: (wall: PublicWall) => void }) {
  const [open, setOpen] = useState(false);
  const [walls, setWalls] = useState<PublicWall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Frames in the preview strip age like every other thumbnail on the
  // map; without this they'd be frozen at whenever the panel opened.
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/dashboards/public");
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { dashboards: PublicWall[] };
      setWalls(payload.dashboards ?? []);
    } catch {
      setError("Couldn't load published walls.");
      setWalls([]);
    }
  }, []);

  return (
    <div ref={panelRef} className="absolute bottom-3 left-36 z-[1100] sm:left-40">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Fetched on first open rather than on mount: most visitors
          // never open this, and it is a database query per view.
          if (next && walls === null) void load();
        }}
        className="flex items-center gap-2 rounded-lg border border-wev-border bg-wev-panel/95 px-3 py-2 text-xs font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-wev-accent" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
        </svg>
        Shared walls
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 max-h-[min(28rem,calc(100dvh-9rem))] w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-wev-border bg-wev-panel/97 p-2 shadow-2xl backdrop-blur-sm">
          {walls === null && <p className="px-2 py-4 text-center text-xs text-wev-muted">Loading…</p>}

          {walls !== null && walls.length === 0 && (
            <p className="px-2 py-4 text-center text-[11px] leading-relaxed text-wev-muted">
              {error ?? "Nobody has published a wall yet. Save one and mark it public to put it here."}
            </p>
          )}

          {walls?.map((wall) => (
            <button
              key={wall.id}
              type="button"
              onClick={() => {
                onOpen(wall);
                setOpen(false);
              }}
              className="mb-1 w-full rounded border border-transparent p-1.5 text-left transition-colors hover:border-wev-border hover:bg-wev-panel-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-wev-text">{wall.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-wev-muted">
                  {wall.cams.length} {wall.cams.length === 1 ? "camera" : "cameras"}
                </span>
              </div>
              {wall.author && <p className="truncate text-[10px] text-wev-muted">by {wall.author}</p>}
              <Strip cams={wall.cams} nowSeconds={nowSeconds} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
