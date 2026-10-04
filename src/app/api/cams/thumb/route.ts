import { NextResponse } from "next/server";
import { getCamById } from "@/lib/cams/registry";
import { browserTtlSeconds, getFrame, peekThumbnail } from "@/lib/cams/thumbCache";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * A single map view pulls up to ~140 frames, and a session that sits open
 * refreshes a slice of those every couple of minutes — so this ceiling
 * has to be high. 1,200/min still leaves room for several map loads a
 * minute while stopping a loop from using us to hammer a state DOT's
 * camera servers.
 */
const RATE_LIMIT = { limit: 1200, windowMs: 60_000 };

/**
 * Serves a camera's current frame from our own origin.
 *
 * The id is looked up in the catalogue and the upstream URL comes from
 * there — a caller can't hand this route an arbitrary URL to fetch, which
 * is what keeps it from being an open image proxy. Camera ids are taken
 * from a query parameter rather than a path segment because they contain
 * colons and dots (`tfl:JamCams_00001.07450`).
 */

export async function GET(request: Request) {
  const rate = checkRateLimit(request, "thumb", RATE_LIMIT);
  if (!rate.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) },
    });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) return new NextResponse(null, { status: 400 });

  const cam = await getCamById(id);
  if (!cam) return new NextResponse(null, { status: 404 });

  const wantsFull = params.get("size") === "full";

  try {
    const frame = await getFrame(cam, !wantsFull);
    return new NextResponse(new Uint8Array(frame.body), {
      headers: {
        "Content-Type": frame.contentType,
        // Matching the server-side TTL means a client that leaves the map
        // open picks up a genuinely new frame roughly when one exists,
        // rather than hammering for pictures that haven't changed.
        "Cache-Control": `public, max-age=${browserTtlSeconds(cam)}`,
      },
    });
  } catch (error) {
    // The full-size frame failed but the thumbnail is in hand: serve
    // that. It is the same camera a moment earlier, and the panel showing
    // it small beats the panel claiming the camera is down while its
    // thumbnail sits on the map behind it. Marked uncacheable so the next
    // refresh asks for the real thing again.
    const fallback = wantsFull ? peekThumbnail(cam) : null;
    if (fallback) {
      return new NextResponse(new Uint8Array(fallback.body), {
        headers: { "Content-Type": fallback.contentType, "Cache-Control": "no-store" },
      });
    }

    // A dead camera is completely normal here — feeds list cameras that
    // are offline, roadworked away or simply broken. The map treats a 502
    // as "drop this tile" and moves on, so this must not be noisy.
    console.warn(`[cams] frame failed for ${id}:`, error instanceof Error ? error.message : error);
    return new NextResponse(null, { status: 502 });
  }
}
