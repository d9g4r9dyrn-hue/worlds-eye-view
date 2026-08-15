"use client";

import { useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import { getMyLocation, locationSupported, type Coords } from "@/lib/geolocate";

/**
 * One panel, three ways to find a set of cameras.
 *
 * These began as one feature (cameras along a route) and grew into three
 * that differ only in how they choose a set of cameras. They live in a
 * single tabbed panel rather than three stacked collapsibles because the
 * map's top-left corner is finite and a phone's is more finite still —
 * three separate headers would push the third off the bottom of a small
 * screen before it was ever opened.
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

export interface NearbyResult {
  center: { lat: number; lon: number; label: string };
  radiusMeters: number;
  cameras: (PublicCam & { meters: number })[];
  totalNearby: number;
}

export interface SunResult {
  phase: "sunrise" | "sunset";
  at: string;
  cameras: (PublicCam & { sunAltitudeDeg: number })[];
  totalInBand: number;
}

type Mode = "route" | "place" | "sun";

/** Corridor widths that mean something to a person, rather than a raw slider. */
const CORRIDORS: { label: string; meters: number }[] = [
  { label: "On the road", meters: 300 },
  { label: "Nearby", meters: 1_000 },
  { label: "Wider", meters: 5_000 },
];

/** Same idea for a point search — "walking distance" up to "this region". */
const RADII: { label: string; meters: number }[] = [
  { label: "In town", meters: 5_000 },
  { label: "Around", meters: 25_000 },
  { label: "Region", meters: 120_000 },
];

function formatKm(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

/** "Use where I am" — same control on both tabs that can take a point. */
function HereButton({
  active,
  busy,
  label,
  onClick,
  onClear,
}: {
  active: boolean;
  busy: boolean;
  label: string;
  onClick: () => void;
  onClear: () => void;
}) {
  // Hidden entirely where the browser can't do it, rather than shown and
  // failing on click.
  if (!locationSupported()) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={active ? onClear : onClick}
      className={`flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
        active
          ? "border-sky-700 bg-sky-400/10 text-wev-accent"
          : "border-wev-border bg-wev-panel-2 text-wev-muted hover:text-wev-text"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
      {busy ? "Locating…" : active ? `${label} — tap to clear` : label}
    </button>
  );
}

const TAB_BASE =
  "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors";

/** Shared "how many cameras" slider — identical in all three modes. */
function CountSlider({
  value,
  onChange,
  hint,
}: {
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-wev-muted">
        <span>How many cameras</span>
        <span className="tabular-nums text-wev-text">{value}</span>
      </label>
      <input
        type="range"
        min={2}
        max={64}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-sky-400"
      />
      <p className="text-[10px] leading-tight text-wev-muted">{hint}</p>
    </div>
  );
}

function SubmitButton({ busy, disabled, label }: { busy: boolean; disabled: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
    >
      {busy ? "Looking…" : label}
    </button>
  );
}

function SendRow({
  count,
  onSend,
  onClear,
}: {
  count: number;
  onSend: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      <button
        type="button"
        disabled={count === 0}
        onClick={onSend}
        className="flex-1 rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
      >
        Send to multicam
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded border border-wev-border bg-wev-panel-2 px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:text-wev-text"
      >
        Clear
      </button>
    </div>
  );
}

export function WallBuilder({
  routeResult,
  onRouteResult,
  onSendToWall,
}: {
  routeResult: RouteResult | null;
  onRouteResult: (result: RouteResult | null) => void;
  onSendToWall: (cams: PublicCam[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("route");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The browser's fix, held once and shared by both tabs.
   *
   * Which end of a route it stands for is tracked separately, because
   * "from here to Orlando" and "from Tampa to here" are both reasonable
   * and the fix itself is the same either way.
   */
  const [here, setHere] = useState<Coords | null>(null);
  const [routeEnd, setRouteEnd] = useState<"from" | "to" | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = async (): Promise<Coords | null> => {
    if (here) return here;
    setLocating(true);
    setError(null);
    try {
      const coords = await getMyLocation();
      setHere(coords);
      return coords;
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : "Couldn't get your location.");
      return null;
    } finally {
      setLocating(false);
    }
  };

  // Route mode
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [corridorMeters, setCorridorMeters] = useState(1_000);
  const [routeMax, setRouteMax] = useState(12);

  // Place mode
  const [place, setPlace] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(25_000);
  const [placeMax, setPlaceMax] = useState(12);
  const [nearbyResult, setNearbyResult] = useState<NearbyResult | null>(null);
  const [usingHere, setUsingHere] = useState(false);

  // Sun mode
  const [phase, setPhase] = useState<"sunrise" | "sunset">("sunset");
  const [sunMax, setSunMax] = useState(12);
  const [sunResult, setSunResult] = useState<SunResult | null>(null);

  /** One request helper — all three endpoints share this shape. */
  async function post<T>(url: string, payload: unknown, apply: (result: T | null) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "That didn't work.");
        apply(null);
        return;
      }
      apply(data as T);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const resultCount =
    mode === "route"
      ? routeResult?.cameras.length
      : mode === "place"
        ? nearbyResult?.cameras.length
        : sunResult?.cameras.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg border border-wev-border bg-wev-panel/95 px-2 py-1.5 text-[11px] font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2 sm:gap-2 sm:px-2.5 sm:py-2 sm:text-xs"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-wev-accent sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="19" r="2.2" />
            <circle cx="18" cy="5" r="2.2" />
            <path d="M8 18.5c6.5-1 3.5-12 8-13" />
          </svg>
          Find cameras
          {resultCount ? (
            <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-wev-accent">{resultCount}</span>
          ) : null}
        </span>
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-wev-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[1100] mt-1.5 max-h-[min(34rem,calc(100dvh-10rem))] w-[17rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-wev-border bg-wev-panel/97 p-2.5 shadow-2xl backdrop-blur-sm">
          <div className="mb-2 flex gap-1 rounded border border-wev-border bg-wev-panel-2 p-0.5">
            {(
              [
                ["route", "Route"],
                ["place", "Place"],
                ["sun", "Sun"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`${TAB_BASE} ${
                  mode === value ? "bg-sky-400/15 text-wev-accent" : "text-wev-muted hover:text-wev-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "route" && (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  // Either end may be the current location instead of text.
                  if ((!from.trim() && routeEnd !== "from") || (!to.trim() && routeEnd !== "to")) return;
                  void post<RouteResult>(
                    "/api/route",
                    {
                      from,
                      to,
                      corridorMeters,
                      maxCameras: routeMax,
                      ...(routeEnd === "from" && here ? { fromLat: here.lat, fromLon: here.lon } : {}),
                      ...(routeEnd === "to" && here ? { toLat: here.lat, toLon: here.lon } : {}),
                    },
                    onRouteResult
                  );
                }}
                className="space-y-2"
              >
                <input
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  disabled={routeEnd === "from"}
                  placeholder={routeEnd === "from" ? "My location" : "From — e.g. Tampa, FL"}
                  className="w-full rounded border border-wev-border bg-wev-panel-2 px-2 py-1.5 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
                />
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  disabled={routeEnd === "to"}
                  placeholder={routeEnd === "to" ? "My location" : "To — e.g. Orlando, FL"}
                  className="w-full rounded border border-wev-border bg-wev-panel-2 px-2 py-1.5 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
                />

                <div className="flex gap-1">
                  <HereButton
                    active={routeEnd === "from"}
                    busy={locating}
                    label="Start here"
                    onClick={async () => {
                      if (await locate()) {
                        setRouteEnd("from");
                        setFrom("");
                      }
                    }}
                    onClear={() => setRouteEnd(null)}
                  />
                  <HereButton
                    active={routeEnd === "to"}
                    busy={locating}
                    label="End here"
                    onClick={async () => {
                      if (await locate()) {
                        setRouteEnd("to");
                        setTo("");
                      }
                    }}
                    onClear={() => setRouteEnd(null)}
                  />
                </div>

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

                <CountSlider
                  value={routeMax}
                  onChange={setRouteMax}
                  hint="Spread evenly along the drive, not just the first few — so you get the whole journey rather than the first city."
                />
                <SubmitButton busy={busy} disabled={
                    busy ||
                    (!from.trim() && routeEnd !== "from") ||
                    (!to.trim() && routeEnd !== "to")
                  } label="Search this route" />
              </form>

              {routeResult && (
                <div className="mt-3 border-t border-wev-border pt-2.5">
                  <p className="truncate text-[11px] text-wev-text">
                    {routeResult.start.label.split(",")[0]} → {routeResult.end.label.split(",")[0]}
                  </p>
                  <p className="text-[11px] text-wev-muted">
                    {formatKm(routeResult.route.distanceMeters)} · {formatDuration(routeResult.route.durationSeconds)}
                  </p>
                  <p className="mt-1 text-[11px] text-wev-muted">
                    <span className="text-wev-text">{routeResult.cameras.length}</span> camera
                    {routeResult.cameras.length === 1 ? "" : "s"}
                    {routeResult.totalInCorridor > routeResult.cameras.length && (
                      <> of {routeResult.totalInCorridor.toLocaleString()} along the way</>
                    )}
                  </p>
                  <SendRow
                    count={routeResult.cameras.length}
                    onSend={() => onSendToWall(routeResult.cameras)}
                    onClear={() => {
                      onRouteResult(null);
                      setError(null);
                    }}
                  />
                  {routeResult.cameras.length > 0 && (
                    <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                      {routeResult.cameras.map((cam) => (
                        <li key={cam.id} className="flex items-baseline gap-1.5 text-[11px]">
                          <span className="w-11 shrink-0 tabular-nums text-wev-muted">{formatKm(cam.alongMeters)}</span>
                          <span className="truncate text-wev-text">{cam.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}

          {mode === "place" && (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!place.trim() && !usingHere) return;
                  void post<NearbyResult>(
                    "/api/nearby",
                    usingHere && here
                      ? { lat: here.lat, lon: here.lon, radiusMeters, maxCameras: placeMax }
                      : { place, radiusMeters, maxCameras: placeMax },
                    setNearbyResult
                  );
                }}
                className="space-y-2"
              >
                <input
                  value={place}
                  onChange={(event) => setPlace(event.target.value)}
                  disabled={usingHere}
                  placeholder={usingHere ? "My location" : "Where — e.g. Reykjavík"}
                  className="w-full rounded border border-wev-border bg-wev-panel-2 px-2 py-1.5 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
                />

                <HereButton
                  active={usingHere}
                  busy={locating}
                  label="Cameras near me"
                  onClick={async () => {
                    if (await locate()) {
                      setUsingHere(true);
                      setPlace("");
                    }
                  }}
                  onClear={() => setUsingHere(false)}
                />

                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-wev-muted">How far out</p>
                  <div className="flex gap-1">
                    {RADII.map((option) => (
                      <button
                        key={option.meters}
                        type="button"
                        onClick={() => setRadiusMeters(option.meters)}
                        className={`flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors ${
                          radiusMeters === option.meters
                            ? "border-sky-700 bg-sky-400/10 text-wev-accent"
                            : "border-wev-border bg-wev-panel-2 text-wev-muted hover:text-wev-text"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <CountSlider value={placeMax} onChange={setPlaceMax} hint="Closest first." />
                <SubmitButton busy={busy} disabled={busy || (!place.trim() && !usingHere)} label="Search near here" />
              </form>

              {nearbyResult && (
                <div className="mt-3 border-t border-wev-border pt-2.5">
                  <p className="truncate text-[11px] text-wev-text">{nearbyResult.center.label}</p>
                  <p className="mt-1 text-[11px] text-wev-muted">
                    <span className="text-wev-text">{nearbyResult.cameras.length}</span> camera
                    {nearbyResult.cameras.length === 1 ? "" : "s"} within {formatKm(nearbyResult.radiusMeters)}
                    {nearbyResult.totalNearby > nearbyResult.cameras.length && (
                      <> of {nearbyResult.totalNearby.toLocaleString()}</>
                    )}
                  </p>
                  <SendRow
                    count={nearbyResult.cameras.length}
                    onSend={() => onSendToWall(nearbyResult.cameras)}
                    onClear={() => setNearbyResult(null)}
                  />
                  {nearbyResult.cameras.length > 0 && (
                    <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                      {nearbyResult.cameras.map((cam) => (
                        <li key={cam.id} className="flex items-baseline gap-1.5 text-[11px]">
                          <span className="w-11 shrink-0 tabular-nums text-wev-muted">{formatKm(cam.meters)}</span>
                          <span className="truncate text-wev-text">{cam.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}

          {mode === "sun" && (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void post<SunResult>("/api/sun", { phase, maxCameras: sunMax }, setSunResult);
                }}
                className="space-y-2"
              >
                <div className="flex gap-1">
                  {(
                    [
                      ["sunrise", "Sunrise"],
                      ["sunset", "Sunset"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPhase(value)}
                      className={`flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors ${
                        phase === value
                          ? "border-sky-700 bg-sky-400/10 text-wev-accent"
                          : "border-wev-border bg-wev-panel-2 text-wev-muted hover:text-wev-text"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className="text-[10px] leading-tight text-wev-muted">
                  Somewhere on Earth it is always both. This finds the cameras whose own sky has the sun on
                  the horizon right now, spread out along the line between night and day.
                </p>

                <CountSlider value={sunMax} onChange={setSunMax} hint="Best light first, then spread apart." />
                <SubmitButton busy={busy} disabled={busy} label={`Find ${phase}s`} />
              </form>

              {sunResult && (
                <div className="mt-3 border-t border-wev-border pt-2.5">
                  <p className="text-[11px] text-wev-muted">
                    <span className="text-wev-text">{sunResult.cameras.length}</span> camera
                    {sunResult.cameras.length === 1 ? "" : "s"} at {sunResult.phase}
                    {sunResult.totalInBand > sunResult.cameras.length && (
                      <> of {sunResult.totalInBand.toLocaleString()} in the light</>
                    )}
                  </p>
                  <SendRow
                    count={sunResult.cameras.length}
                    onSend={() => onSendToWall(sunResult.cameras)}
                    onClear={() => setSunResult(null)}
                  />
                  {sunResult.cameras.length > 0 && (
                    <ol className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                      {sunResult.cameras.map((cam) => (
                        <li key={cam.id} className="flex items-baseline gap-1.5 text-[11px]">
                          <span className="w-11 shrink-0 tabular-nums text-wev-muted">
                            {cam.sunAltitudeDeg > 0 ? "+" : ""}
                            {cam.sunAltitudeDeg}°
                          </span>
                          <span className="truncate text-wev-text">{cam.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
