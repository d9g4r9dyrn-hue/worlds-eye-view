import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/cams/registry";
import { isWithin, thinForViewport, type BoundingBox } from "@/lib/cams/spatial";
import { isKnownUnavailable } from "@/lib/cams/thumbCache";
import { toPublicCam, type Cam } from "@/lib/cams/types";

/**
 * Cameras for the current viewport.
 *
 * Thinning happens here rather than in the browser for two reasons: the
 * client would otherwise download tens of thousands of cameras to throw
 * nearly all of them away, and the server is the only place that can rank
 * a candidate against every other camera in the box rather than against
 * the subset it happens to hold.
 *
 * Layer filtering is a server concern for a subtler reason. Thinning
 * awards one slot per patch of screen, and over California every one of
 * those slots goes to a highway camera. Filtering the *response*
 * client-side would therefore show nothing when you asked for volcanoes —
 * the volcanoes lost their slots before the browser ever saw them.
 * Filtering before thinning is what makes "show me only volcanoes"
 * actually reveal them.
 */

function readNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Absent parameter means "everything"; present-but-empty means "nothing". */
function readSet(params: URLSearchParams, key: string): Set<string> | null {
  const raw = params.get(key);
  if (raw === null) return null;
  return new Set(raw.split(",").filter(Boolean));
}

function countBy(cams: Cam[], pick: (cam: Cam) => string) {
  const counts = new Map<string, number>();
  for (const cam of cams) counts.set(pick(cam), (counts.get(pick(cam)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const south = readNumber(params, "south");
  const west = readNumber(params, "west");
  const north = readNumber(params, "north");
  const east = readNumber(params, "east");
  const zoom = readNumber(params, "zoom");

  if (south === null || west === null || north === null || east === null || zoom === null) {
    return NextResponse.json({ error: "south, west, north, east and zoom are all required" }, { status: 400 });
  }
  if (south > north) {
    return NextResponse.json({ error: "south must not be north of north" }, { status: 400 });
  }

  // Leaflet reports longitudes well outside [-180, 180] — panning across
  // the antimeridian keeps accumulating, and a zoomed-out world view
  // routinely reports something like -540..540.
  //
  // The span has to be checked BEFORE normalising: wrapping each edge
  // independently maps 180 to -180, which would turn a whole-world
  // viewport into a zero-width sliver at the antimeridian and return no
  // cameras at all.
  const spansGlobe = east - west >= 360;
  const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

  const box: BoundingBox = {
    south: Math.max(-90, south),
    north: Math.min(90, north),
    west: spansGlobe ? -180 : wrap(west),
    east: spansGlobe ? 180 : wrap(east),
  };

  const clampedZoom = Math.min(19, Math.max(0, zoom));
  const limit = Math.min(300, Math.max(20, readNumber(params, "limit") ?? 140));
  const categories = readSet(params, "categories");
  const providers = readSet(params, "providers");

  const catalog = await getCatalog();
  const inView = catalog.cams.filter((cam) => isWithin(box, cam.lat, cam.lon));

  // Facets are counted on the unfiltered viewport so the layers control
  // keeps listing a layer (and its real total) even while it's switched
  // off — otherwise unchecking something would make it vanish from the
  // very control you'd use to switch it back on.
  const facets = {
    categories: countBy(inView, (cam) => cam.category),
    providers: countBy(inView, (cam) => cam.provider),
  };

  const selected = inView.filter(
    (cam) => (!categories || categories.has(cam.category)) && (!providers || providers.has(cam.provider))
  );

  // Cameras whose frames just failed are excluded before thinning, so a
  // dead one doesn't win a slot and leave a hole where a working
  // neighbour could have been.
  const live = selected.filter((cam) => !isKnownUnavailable(cam.id));
  const visible = thinForViewport(live, { zoom: clampedZoom, limit });

  return NextResponse.json(
    {
      cams: visible.map(toPublicCam),
      /** Cameras matching the active layers in this box, before thinning. */
      matching: selected.length,
      /** Every camera in this box, regardless of layer selection. */
      inView: inView.length,
      total: catalog.cams.length,
      facets,
      sources: catalog.sources,
    },
    {
      headers: {
        // The roster changes slowly; the frames it points at are what move.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
