"use client";

/**
 * Where the browser thinks you are.
 *
 * Thin wrapper over the Geolocation API for two reasons: its callback
 * shape doesn't compose with async code, and its failure modes need
 * translating into something a person can act on. "Position unavailable"
 * on its own tells a user nothing about whether to retry, grant a
 * permission, or give up.
 *
 * Requires a secure context. On localhost that's satisfied; over plain
 * HTTP on a phone it is not, and the browser rejects it outright rather
 * than prompting — which is worth saying explicitly, because the symptom
 * otherwise looks like a permission the user never got asked for.
 */

export interface Coords {
  lat: number;
  lon: number;
  /** Metres of uncertainty the browser reports, when it reports any. */
  accuracyMeters: number | null;
}

export class LocationError extends Error {}

/** Longer than feels necessary: a cold GPS fix on a phone genuinely can
 *  take this long, and failing at five seconds trains people to think the
 *  feature is broken when it merely needed patience. */
const TIMEOUT_MS = 15_000;

export function locationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function getMyLocation(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!locationSupported()) {
      reject(new LocationError("This browser can't share a location."));
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(new LocationError("Location needs a secure (https) connection."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      (error) => {
        // Codes rather than messages: the messages are browser-specific
        // and some are empty.
        if (error.code === error.PERMISSION_DENIED) {
          reject(new LocationError("Location permission was declined."));
        } else if (error.code === error.TIMEOUT) {
          reject(new LocationError("Took too long to get a fix — try again."));
        } else {
          reject(new LocationError("Couldn't work out where you are."));
        }
      },
      {
        // High accuracy costs battery and time, and every use here is
        // "which cameras are near me" at kilometre scale, where a
        // coarse network fix is already far better than needed.
        enableHighAccuracy: false,
        timeout: TIMEOUT_MS,
        // A fix from the last few minutes is fine and instant; this is
        // not a navigation app.
        maximumAge: 300_000,
      }
    );
  });
}
