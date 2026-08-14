"use client";

import { useEffect, useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import { CATEGORY_LABELS, formatCadence, formatCoordinate } from "@/lib/cams/display";

/**
 * The panel you get after clicking a thumbnail — the full frame at the
 * size the camera actually publishes, plus who runs it and where it is.
 *
 * It reloads on the camera's own advertised cadence rather than a fixed
 * interval, because those genuinely differ: a London JamCam moves every
 * few minutes while an Alaskan ashcam is on a ten-minute cycle, and
 * polling either faster than it publishes just burns requests for an
 * identical picture.
 */

export function CamDetail({
  cam,
  inWall,
  onToggleWall,
  onOpenWall,
  onClose,
}: {
  cam: PublicCam;
  inWall: boolean;
  onToggleWall: () => void;
  onOpenWall: () => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  // Selecting a different camera has to reset all three of these, and the
  // caller does it by keying this component on cam.id so React remounts
  // it. That's why there's no reset effect here — clearing state from an
  // effect would render the previous camera's frame for a beat first.

  useEffect(() => {
    const periodMs = Math.max(45, cam.refreshSeconds) * 1000;
    const timer = setInterval(() => setVersion((current) => current + 1), periodMs);
    return () => clearInterval(timer);
  }, [cam.refreshSeconds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const source = new URLSearchParams({ id: cam.id, size: "full" });
  if (version > 0) source.set("v", String(version));

  return (
    <div className="absolute inset-x-0 bottom-0 z-[1200] p-3 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:p-4">
      <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-wev-border bg-wev-panel/97 shadow-2xl backdrop-blur-md">
        <div className="flex items-start justify-between gap-3 border-b border-wev-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-wev-text">{cam.title}</h2>
            <p className="truncate text-xs text-wev-muted">
              {[cam.place, cam.country].filter(Boolean).join(", ") || CATEGORY_LABELS[cam.category]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="shrink-0 rounded-full p-1 text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full shrink-0 bg-black">
          {state === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-wev-muted">Loading frame…</div>
          )}
          {state === "failed" ? (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-wev-muted">
              This camera isn&apos;t responding right now. Feeds list cameras that are offline or under maintenance.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- next/image would need every camera host in remotePatterns; the frame already comes through our own proxy
            <img
              key={`${cam.id}:${version}`}
              src={`/api/cams/thumb?${source.toString()}`}
              alt={`Live view from ${cam.title}`}
              className="h-full w-full object-contain"
              onLoad={() => {
                setState("ready");
                setLoadedAt(new Date());
              }}
              onError={() => setState("failed")}
            />
          )}
        </div>

        <div className="flex gap-2 border-b border-wev-border px-4 py-2.5">
          <button
            type="button"
            onClick={onToggleWall}
            className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              inWall
                ? "border-green-700/60 bg-green-500/10 text-green-300 hover:bg-green-500/20"
                : "border-wev-border bg-wev-panel-2 text-wev-text hover:border-sky-700 hover:text-wev-accent"
            }`}
          >
            {inWall ? "✓ In multicam" : "+ Add to multicam"}
          </button>
          {inWall && (
            <button
              type="button"
              onClick={onOpenWall}
              className="rounded-md border border-wev-border bg-wev-panel-2 px-3 py-1.5 text-xs font-medium text-wev-text transition-colors hover:text-wev-accent"
            >
              Open
            </button>
          )}
        </div>

        <div className="space-y-2 overflow-y-auto px-4 py-3 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-wev-muted">Operator</span>
            <span className="text-right text-wev-text">{cam.provider}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-wev-muted">Type</span>
            <span className="text-right text-wev-text">{CATEGORY_LABELS[cam.category]}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-wev-muted">Position</span>
            <span className="text-right font-mono text-[11px] text-wev-text">{formatCoordinate(cam.lat, cam.lon)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-wev-muted">Updates</span>
            <span className="text-right text-wev-text">about every {formatCadence(cam.refreshSeconds)}</span>
          </div>
          {loadedAt && (
            <div className="flex justify-between gap-3">
              <span className="text-wev-muted">This frame</span>
              <span className="text-right text-wev-text">
                fetched {loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}

          {cam.sourcePage && (
            <a
              href={cam.sourcePage}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-wev-accent transition-colors hover:underline"
            >
              View at {cam.provider}
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
