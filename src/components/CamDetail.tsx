"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const fullRef = useRef<HTMLDivElement | null>(null);

  // Selecting a different camera has to reset all three of these, and the
  // caller does it by keying this component on cam.id so React remounts
  // it. That's why there's no reset effect here — clearing state from an
  // effect would render the previous camera's frame for a beat first.

  useEffect(() => {
    const periodMs = Math.max(45, cam.refreshSeconds) * 1000;
    const timer = setInterval(() => setVersion((current) => current + 1), periodMs);
    return () => clearInterval(timer);
  }, [cam.refreshSeconds]);

  /**
   * Real fullscreen where it exists, CSS fullscreen everywhere else.
   *
   * iOS Safari refuses requestFullscreen on anything that isn't a
   * <video>, so the API alone would simply not work on iPhones - which
   * is where filling the screen with one camera matters most. The
   * `expanded` state does the layout work and stands on its own; the
   * Fullscreen API is a bonus that also hides the browser chrome where
   * it is allowed. Same arrangement as the multicam wall.
   */
  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  /**
   * Ask for real fullscreen once the overlay exists.
   *
   * Not in the click handler: the overlay is only rendered while
   * `expanded`, so at click time its ref is still null and the request
   * would silently do nothing. Running it after the element mounts is
   * still inside the browser's transient user activation window, so the
   * gesture requirement is satisfied.
   */
  useEffect(() => {
    if (!expanded) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      return;
    }
    const node = fullRef.current;
    if (node?.requestFullscreen) void node.requestFullscreen().catch(() => {});
  }, [expanded]);

  // Leaving via the browser's own control (Esc, F11, iOS's swipe) has to
  // put our state back in step.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setExpanded((current) => (current ? false : current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Back out one level at a time: leave fullscreen first, then close
      // the panel. Closing both on one press loses your place.
      if (expanded) {
        if (!document.fullscreenElement) setExpanded(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, expanded]);

  const source = new URLSearchParams({ id: cam.id, size: "full" });
  if (version > 0) source.set("v", String(version));

  return (
    <>
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

        <div className="group/frame relative aspect-[4/3] w-full shrink-0 bg-black">
          {state === "ready" && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label="View fullscreen"
              title="View fullscreen"
              className="absolute right-2 top-2 z-10 rounded-md bg-black/60 p-1.5 text-white/90 opacity-0 transition-opacity hover:bg-black/80 focus:opacity-100 group-hover/frame:opacity-100 [@media(pointer:coarse)]:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
              </svg>
            </button>
          )}
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

    {expanded && (
      <div
        ref={fullRef}
        className="fixed inset-0 z-[2000] flex flex-col bg-black"
        // The whole surface dismisses, since at this size there is
        // nothing else to press and hunting for a small X on a phone is
        // worse than an accidental exit that costs one tap to undo.
        onClick={toggleExpanded}
      >
        {/* object-contain, never cover: a camera frame is the subject,
            and cropping it to fill a differently-shaped screen throws
            away part of the very thing being looked at. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- same proxy as above */}
        <img
          key={`full:${cam.id}:${version}`}
          src={`/api/cams/thumb?${source.toString()}`}
          alt={`Live view from ${cam.title}`}
          className="h-full w-full object-contain"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{cam.title}</p>
            <p className="truncate text-xs text-white/60">
              {[cam.place, cam.country].filter(Boolean).join(", ") || CATEGORY_LABELS[cam.category]}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-black/60 p-1.5 text-white/90">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3" />
            </svg>
          </span>
        </div>
      </div>
    )}
    </>
  );
}
