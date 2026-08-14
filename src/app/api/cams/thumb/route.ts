import { NextResponse } from "next/server";
import { getCamById } from "@/lib/cams/registry";
import { browserTtlSeconds, getFrame } from "@/lib/cams/thumbCache";

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
    // A dead camera is completely normal here — feeds list cameras that
    // are offline, roadworked away or simply broken. The map treats a 502
    // as "drop this tile" and moves on, so this must not be noisy.
    console.warn(`[cams] frame failed for ${id}:`, error instanceof Error ? error.message : error);
    return new NextResponse(null, { status: 502 });
  }
}
