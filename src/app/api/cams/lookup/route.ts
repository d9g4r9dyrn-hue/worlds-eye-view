import { NextResponse } from "next/server";
import { getCamById } from "@/lib/cams/registry";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { parseCamId } from "@/lib/share/view";
import { toPublicCam } from "@/lib/cams/types";

/**
 * One camera by id.
 *
 * Exists for shared links that point at a camera. The viewport query only
 * returns cameras that won a slot at the current zoom, so the camera a
 * link names may well not be in it, and the page needs its details to
 * open the panel.
 */

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function GET(request: Request) {
  const rate = checkRateLimit(request, "lookup", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const id = parseCamId(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const cam = await getCamById(id);
  if (!cam) return NextResponse.json({ error: "No such camera" }, { status: 404 });

  return NextResponse.json(
    { cam: toPublicCam(cam) },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
