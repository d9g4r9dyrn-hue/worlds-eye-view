import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/cams/registry";
import { isKnownUnavailable, selectLiveCams } from "@/lib/cams/thumbCache";
import { toPublicCam } from "@/lib/cams/types";
import { camerasNearPoint } from "@/lib/route/corridor";
import { geocode } from "@/lib/route/services";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Cameras around one place.
 *
 * The route search's simpler sibling: name a town, a landmark, an
 * airport, and get the cameras nearest it, closest first. Accepts raw
 * coordinates too, which is what the map itself sends when you build a
 * wall from wherever you're already looking — no geocoding round-trip
 * for a point we already know.
 *
 * Shares the route endpoint's tighter rate limit whenever it geocodes,
 * for the same reason: Nominatim is donated infrastructure and this is
 * the only way we touch it.
 */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const MIN_RADIUS_M = 250;
const MAX_RADIUS_M = 200_000;
const MAX_CAMERAS = 64;

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "nearby", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many searches. Give it a minute." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    place?: string;
    lat?: number;
    lon?: number;
    radiusMeters?: number;
    maxCameras?: number;
  };

  const radiusMeters = Math.min(
    MAX_RADIUS_M,
    Math.max(MIN_RADIUS_M, Number(body.radiusMeters) || 25_000)
  );
  const maxCameras = Math.min(MAX_CAMERAS, Math.max(1, Number(body.maxCameras) || 12));

  // Coordinates win when both are supplied — they're unambiguous, and
  // skipping the geocode keeps the map's own "cameras around here"
  // button off Nominatim entirely.
  let center: { lat: number; lon: number; label: string } | null = null;

  if (Number.isFinite(body.lat) && Number.isFinite(body.lon)) {
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: "Those coordinates aren't on Earth." }, { status: 400 });
    }
    center = { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  } else {
    const place = String(body.place ?? "").trim();
    if (!place) {
      return NextResponse.json({ error: "A place name is required." }, { status: 400 });
    }
    try {
      const found = await geocode(place);
      if (!found) return NextResponse.json({ error: `Couldn't find "${place}".` }, { status: 404 });
      center = { lat: found.lat, lon: found.lon, label: found.label };
    } catch (error) {
      console.warn("[nearby] geocoding failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Couldn't look that place up right now." }, { status: 502 });
    }
  }

  const catalog = await getCatalog();
  const live = catalog.cams.filter((cam) => !isKnownUnavailable(cam.id));
  const found = camerasNearPoint(live, center, radiusMeters);

  // Nearest-first, so unlike the route search there's no spread to
  // preserve — probing down the list and keeping the first survivors
  // gives exactly the right answer: the closest cameras that work.
  const shortlist = found.slice(0, maxCameras * 2);
  const probeStarted = Date.now();
  const matches = await selectLiveCams(shortlist, maxCameras, (match) => match.cam);
  console.log(
    `[nearby] ${shortlist.length} probed, ${shortlist.length - matches.length} skipped, ` +
      `${matches.length} sent in ${Date.now() - probeStarted}ms`
  );

  return NextResponse.json(
    {
      center,
      radiusMeters,
      cameras: matches.map((match) => ({
        ...toPublicCam(match.cam),
        meters: Math.round(match.meters),
      })),
      totalNearby: found.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
