import { NextResponse } from "next/server";

/**
 * Current RainViewer radar frame.
 *
 * RainViewer publishes an index naming the newest radar composite, and
 * that path changes every ~10 minutes — so the tile URL can't be a
 * constant. The index is fetched here rather than from the browser for
 * one specific reason: the CSP keeps `connect-src` at `'self'`, and
 * letting the page call api.rainviewer.com directly would mean widening
 * it. Tiles themselves still come from RainViewer's CDN (that's an
 * `img-src` entry, unavoidable without proxying every tile, which would
 * be a lot of bandwidth for no benefit).
 *
 * Cached briefly server-side so a room full of viewers doesn't each hit
 * the index for an answer that changes six times an hour.
 */

const INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json";
const CACHE_MS = 120_000;

interface RadarFrame {
  time?: number;
  path?: string;
}

const globalForRadar = globalThis as typeof globalThis & {
  __wevRadar?: { fetchedAt: number; payload: unknown };
};

export async function GET() {
  const cached = globalForRadar.__wevRadar;
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return NextResponse.json(cached.payload, { headers: { "Cache-Control": "public, max-age=120" } });
  }

  try {
    const response = await fetch(INDEX_URL, {
      headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`RainViewer responded ${response.status}`);

    const data = (await response.json()) as { host?: string; radar?: { past?: RadarFrame[] } };
    const past = data.radar?.past ?? [];
    const latest = past[past.length - 1];

    if (!data.host || !latest?.path) throw new Error("RainViewer index had no radar frames");

    const payload = {
      // Full tile template — the client only has to substitute {z}/{x}/{y}.
      urlTemplate: `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
      timestamp: latest.time ?? null,
    };

    globalForRadar.__wevRadar = { fetchedAt: Date.now(), payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, max-age=120" } });
  } catch (error) {
    console.warn("[weather] radar index failed:", error instanceof Error ? error.message : error);
    // The map treats a null template as "weather layer unavailable" and
    // simply doesn't draw it, rather than showing a broken overlay.
    return NextResponse.json({ urlTemplate: null, timestamp: null }, { status: 200 });
  }
}
