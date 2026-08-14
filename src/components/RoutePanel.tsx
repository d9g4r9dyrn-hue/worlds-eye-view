"use client";

import { useState } from "react";
import type { PublicCam } from "@/lib/cams/types";

/**
 * Build a camera wall from a journey.
 *
 * Two place names in, an ordered set of cameras out — arranged the way
 * you'd drive past them, so the multicam wall plays as a trip rather than
 * a pile.
 */

export interface RouteCamera extends PublicCam {
  offsetMeters: number;
  alongMeters: number;
}

export interface RouteResult {
  start: { lat: number; lon: number; label: string };
  end: { lat: number; lon: number; label: string };
  route: { path: { lat: number; lon: number }[]; distanceMeters: number; durationSeconds: number };
  cameras: RouteCamera[];
  totalInCorridor: number;
  corridorMeters: number;
}

/** Corridor widths that mean something to a person, rather than a raw slider. */
const CORRIDORS: { label: string; meters: number }[] = [
  { label: "On the road", meters: 300 },
  { label: "Nearby", meters: 1_000 },
  { label: "Wider", meters: 5_000 },
];

function formatKm(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

export function RoutePanel({
  result,
  onResult,
  onClear,
  onSendToWall,
}: {
  result: RouteResult | null;
  onResult: (result: RouteResult | null) => void;
  onClear: () => void;
  onSendToWall: (cams: PublicCam[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [corridorMeters, setCorridorMeters] = useState(1_000);
  const [maxCameras, setMaxCameras] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!from.trim() || !to.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, corridorMeters, maxCameras }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error ?? "Couldn't plan that route.");
        onResult(null);
        return;
      }
      onResult(payload as RouteResult);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute left-3 top-14 z-[1100] w-[17rem] max-w-[calc(100%-1.5rem)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-wev-border bg-wev-panel/95 px-3 py-2 text-xs font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-wev-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="19" r="2.2" />
            <circle cx="18" cy="5" r="2.2" />
            <path d="M8 18.5c6.5-1 3.5-12 8-13" />
          </svg>
          Along a route
          {result && <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-wev-accent">{result.cameras.length}</span>}
        </span>
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-wev-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 max-h-[min(34rem,calc(100dvh-10rem))] overflow-y-auto rounded-lg border border-wev-border bg-wev-panel/97 p-2.5 shadow-2xl backdrop-blur-sm">
          <form onSubmit={search} className="space-y-2">
            <input
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="From — e.g. Tampa, FL"
              className="w-full rounded border border-wev-border bg-wev-panel-2 px-2 py-1.5 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
            />
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="To — e.g. Orlando, FL"
              className="w-full rounded border border-wev-border bg-wev-panel-2 px-2 py-1.5 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
            />

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-wev-muted">How close to the road</p>
              <div className="flex gap-1">
                {CORRIDORS.map((option) => (
                  <button
                    key={option.meters}
                    type="button"
                    onClick={() => setCorridorMeters(option.meters)}
                    className={`flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors ${
                      corridorMeters === option.meters
                        ? "border-sky-700 bg-sky-400/10 text-wev-accent"
                        : "border-wev-border bg-wev-panel-2 text-wev-muted hover:text-wev-text"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-wev-muted">
                <span>How many cameras</span>
                <span className="tabular-nums text-wev-text">{maxCameras}</span>
              </label>
              <input
                type="range"
                min={2}
                max={64}
                step={1}
                value={maxCameras}
                onChange={(event) => setMaxCameras(Number(event.target.value))}
                className="w-full accent-sky-400"
              />
              <p className="text-[10px] leading-tight text-wev-muted">
                Long trips have hundreds of cameras. These are spread evenly along the drive, not just the first
                few — so you get the whole journey rather than the first city.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy || !from.trim() || !to.trim()}
              className="w-full rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
            >
              {busy ? "Planning…" : "Find cameras"}
            </button>
          </form>

          {error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{error}</p>}

          {result && (
            <div className="mt-3 border-t border-wev-border pt-2.5">
              <p className="truncate text-[11px] text-wev-text">{result.start.label.split(",")[0]} → {result.end.label.split(",")[0]}</p>
              <p className="text-[11px] text-wev-muted">
                {formatKm(result.route.distanceMeters)} · {formatDuration(result.route.durationSeconds)}
              </p>
              <p className="mt-1 text-[11px] text-wev-muted">
                <span className="text-wev-text">{result.cameras.length}</span> camera
                {result.cameras.length === 1 ? "" : "s"}
                {result.totalInCorridor > result.cameras.length && (
                  <> of {result.totalInCorridor.toLocaleString()} along the way</>
                )}
              </p>

              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  disabled={result.cameras.length === 0}
                  onClick={() => onSendToWall(result.cameras)}
                  className="flex-1 rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
                >
                  Send to multicam
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setError(null);
                  }}
                  className="rounded border border-wev-border bg-wev-panel-2 px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:text-wev-text"
                >
                  Clear
                </button>
              </div>

              {result.cameras.length > 0 && (
                <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                  {result.cameras.map((cam) => (
                    <li key={cam.id} className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="w-11 shrink-0 tabular-nums text-wev-muted">
                        {formatKm(cam.alongMeters)}
                      </span>
                      <span className="truncate text-wev-text">{cam.title}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
