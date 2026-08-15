import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/cams/registry";
import { isKnownUnavailable, selectLiveCams } from "@/lib/cams/thumbCache";
import { toPublicCam } from "@/lib/cams/types";
import { camerasAlongRoute, summarise } from "@/lib/route/corridor";
import { geocode, routeBetween } from "@/lib/route/services";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Cameras along a journey.
 *
 * Takes two place names, plots a driving route, and returns the cameras
 * beside it in the order you'd pass them — so the multicam wall reads as
 * a drive rather than an arbitrary set.
 *
 * Tighter rate limit than the other routes: each call can trigger two
 * geocodes and a routing request against donated public infrastructure,
 * so this is the one endpoint where our own traffic could become somebody
 * else's problem.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const MIN_CORRIDOR_M = 100;
const MAX_CORRIDOR_M = 20_000;
const MAX_CAMERAS = 64;

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "route", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many route searches. Give it a minute." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
    corridorMeters?: number;
    maxCameras?: number;
  };

  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  if (!from || !to) {
    return NextResponse.json({ error: "Both a start and a destination are required." }, { status: 400 });
  }

  const corridorMeters = Math.min(
    MAX_CORRIDOR_M,
    Math.max(MIN_CORRIDOR_M, Number(body.corridorMeters) || 1_000)
  );
  const maxCameras = Math.min(MAX_CAMERAS, Math.max(1, Number(body.maxCameras) || 12));

  // Geocoding is serialised and rate limited (see services.ts), so these
  // run in sequence rather than in parallel by design.
  let start, end;
  try {
    start = await geocode(from);
    end = start ? await geocode(to) : null;
  } catch (error) {
    console.warn("[route] geocoding failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't look up those places right now." }, { status: 502 });
  }

  if (!start) return NextResponse.json({ error: `Couldn't find "${from}".` }, { status: 404 });
  if (!end) return NextResponse.json({ error: `Couldn't find "${to}".` }, { status: 404 });

  let route;
  try {
    route = await routeBetween(start, end);
  } catch (error) {
    console.warn("[route] routing failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't plot a route between those points." }, { status: 502 });
  }

  if (!route) {
    return NextResponse.json(
      { error: "No driving route connects those places." },
      { status: 404 }
    );
  }

  const catalog = await getCatalog();
  // Same reasoning as the viewport query: a camera known to be down
  // shouldn't take one of a limited number of slots on the wall.
  const live = catalog.cams.filter((cam) => !isKnownUnavailable(cam.id));

  // One search, then thin — the untrimmed count is what lets the UI say
  // "12 of 214 along this route" and offer to show more.
  const inCorridor = camerasAlongRoute(live, route.path, { corridorMeters });
  const totalInCorridor = inCorridor.length;

  // Spread -> probe -> spread again.
  //
  // The order matters and is easy to get wrong: probing a spread-out
  // shortlist and keeping the first N survivors quietly returns the first
  // N by distance, so a 135km drive comes back as twelve cameras from the
  // first 40km. Instead every shortlisted camera is probed, and the
  // survivors are re-spread — so removing a dead camera near Lakeland
  // pulls in another camera near Lakeland, not one more in Tampa.
  // 2x rather than 3x: every shortlisted camera is a real fetch against
  // somebody else's public server, and at this endpoint's rate limit a 3x
  // spread works out to ~700 upstream requests a minute. Double leaves
  // enough slack to replace a dead camera in the same stretch of road
  // without making us the reason an agency's camera host falls over.
  const shortlist = summarise(inCorridor, Math.min(inCorridor.length, maxCameras * 2));
  const probeStarted = Date.now();
  const alive = await selectLiveCams(shortlist, shortlist.length, (match) => match.cam);
  const matches = summarise(
    alive.sort((a, b) => a.alongMeters - b.alongMeters),
    maxCameras
  );
  console.log(
    `[route] ${shortlist.length} probed, ${shortlist.length - alive.length} dead, ` +
      `${matches.length} sent in ${Date.now() - probeStarted}ms`
  );

  return NextResponse.json(
    {
      start: { lat: start.lat, lon: start.lon, label: start.label },
      end: { lat: end.lat, lon: end.lon, label: end.label },
      route: {
        // Sent at full resolution — the client draws it, and 950 points
        // is a few tens of kilobytes.
        path: route.path,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      },
      cameras: matches.map((match) => ({
        ...toPublicCam(match.cam),
        offsetMeters: Math.round(match.offsetMeters),
        alongMeters: Math.round(match.alongMeters),
      })),
      totalInCorridor,
      corridorMeters,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
