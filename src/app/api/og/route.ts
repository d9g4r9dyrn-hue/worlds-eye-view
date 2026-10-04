import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { renderFallback, renderPreview } from "@/lib/share/ogImage";
import { DEFAULT_VIEW, parseView, snapForPreview, viewQuery } from "@/lib/share/view";

/**
 * The link-preview picture for a map view.
 *
 * `/api/og?lat=..&lon=..&zoom=..` draws that view; add `cam=<id>` and it
 * leads with that camera. With no parameters it draws the default view,
 * which is what the bare home page advertises.
 *
 * Each render fetches a few dozen tiles and camera frames, so the result
 * is kept for ten minutes and the address is snapped to a coarse grid
 * (see snapForPreview) so nearby links share one entry. Ten minutes is
 * also about as stale as a "live" picture should be allowed to get; the
 * platforms keep their own copy for days regardless.
 */

/** A person shares a handful of links; a crawler fetches each once. */
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

const TTL_MS = 10 * 60_000;

/** Around 150KB each, so this is a ceiling of roughly 12MB. */
const MAX_ENTRIES = 80;

interface Entry {
  body: Buffer;
  expiresAt: number;
}

const globalForOg = globalThis as typeof globalThis & {
  __wevOgCache?: Map<string, Entry>;
  __wevOgInFlight?: Map<string, Promise<Buffer>>;
};

const cache: Map<string, Entry> = (globalForOg.__wevOgCache ??= new Map());

/** Concurrent requests for one picture share a single render. */
const inFlight: Map<string, Promise<Buffer>> = (globalForOg.__wevOgInFlight ??= new Map());

function respond(body: Buffer, maxAge: number) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=3600`,
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = parseView((key) => params.get(key));
  const view = snapForPreview(parsed ?? DEFAULT_VIEW);
  const key = viewQuery(view);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return respond(hit.body, 600);

  // Checked after the cache on purpose: a picture that is already drawn
  // costs nothing to hand out again, and the limit exists for renders.
  const rate = checkRateLimit(request, "og", RATE_LIMIT);
  if (!rate.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) },
    });
  }

  let job = inFlight.get(key);
  if (!job) {
    job = renderPreview(view, parsed === null).finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }

  try {
    const body = await job;
    cache.delete(key);
    cache.set(key, { body, expiresAt: Date.now() + TTL_MS });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    return respond(body, 600);
  } catch (error) {
    console.warn("[og] render failed:", error instanceof Error ? error.message : error);
    // A crawler that gets an error shows the link with no picture at all,
    // and keeps showing it that way for days. A plain branded card,
    // marked short-lived so the next fetch tries again, is the better
    // failure.
    return respond(await renderFallback(), 60);
  }
}
