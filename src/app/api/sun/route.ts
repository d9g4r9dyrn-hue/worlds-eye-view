import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/cams/registry";
import { isKnownUnavailable, selectLiveCams } from "@/lib/cams/thumbCache";
import { toPublicCam } from "@/lib/cams/types";
import { isAtPhase, phaseScore, solarPosition, type SunPhase } from "@/lib/sun";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Cameras watching the sun come up, or go down, somewhere on Earth
 * right now.
 *
 * There is always a sunrise and always a sunset happening — the
 * terminator never stops moving — so this needs no date input and takes
 * no place. It asks every camera in the catalogue how high the sun is in
 * its own sky and keeps the ones near their horizon.
 *
 * No geocoding and no external calls, so the rate limit is the ordinary
 * one; the cost here is the frame probing, same as everywhere else.
 */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const MAX_CAMERAS = 64;

/**
 * Minimum separation between two chosen cameras.
 *
 * Without this the answer is dominated by whichever well-covered country
 * the terminator happens to be crossing — twelve motorway cameras in one
 * county, all facing the same sky. The terminator is 20,000km long; a
 * wall drawn from it should feel like it.
 */
const MIN_SEPARATION_M = 120_000;

const EARTH_RADIUS_M = 6_371_000;

function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  // Haversine here rather than the corridor's flat approximation: these
  // distances are continental, where the flat-earth error is large.
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "sun", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many searches. Give it a minute." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    phase?: string;
    maxCameras?: number;
  };

  const phase: SunPhase = body.phase === "sunrise" ? "sunrise" : "sunset";
  const maxCameras = Math.min(MAX_CAMERAS, Math.max(1, Number(body.maxCameras) || 12));

  const now = new Date();
  const catalog = await getCatalog();

  const candidates: { cam: (typeof catalog.cams)[number]; score: number; altitudeDeg: number }[] = [];
  for (const cam of catalog.cams) {
    if (isKnownUnavailable(cam.id)) continue;
    const position = solarPosition(cam.lat, cam.lon, now);
    if (!isAtPhase(position, phase)) continue;
    candidates.push({ cam, score: phaseScore(position), altitudeDeg: position.altitudeDeg });
  }

  // Best light first, then spread. Sorting before the separation pass is
  // what makes the greedy choice reasonable: each camera kept is the most
  // photogenic one remaining that isn't already represented nearby.
  candidates.sort((a, b) => a.score - b.score);

  const spread: typeof candidates = [];
  for (const candidate of candidates) {
    if (spread.length >= maxCameras * 2) break;
    const tooClose = spread.some(
      (chosen) => metersBetween(chosen.cam, candidate.cam) < MIN_SEPARATION_M
    );
    if (!tooClose) spread.push(candidate);
  }

  const probeStarted = Date.now();
  const matches = await selectLiveCams(spread, maxCameras, (item) => item.cam);
  console.log(
    `[sun] ${phase}: ${candidates.length} in the band, ${spread.length} after spreading, ` +
      `${matches.length} sent in ${Date.now() - probeStarted}ms`
  );

  return NextResponse.json(
    {
      phase,
      at: now.toISOString(),
      cameras: matches.map((match) => ({
        ...toPublicCam(match.cam),
        // Rounded because a hundredth of a degree of solar altitude is
        // well past what the UI could meaningfully show.
        sunAltitudeDeg: Math.round(match.altitudeDeg * 10) / 10,
      })),
      totalInBand: candidates.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
