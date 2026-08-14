import { NextResponse } from "next/server";
import { peekCatalog } from "@/lib/cams/registry";

/**
 * Liveness and catalogue health.
 *
 * Deliberately does NOT trigger a catalogue load — it reports whatever
 * state the registry is already in. A healthcheck that could kick off a
 * 40-second fetch would time out on a cold process and get the deploy
 * marked dead, which is exactly the failure it exists to detect.
 *
 * So: `ok` is about the process being able to serve, and `warm` tells you
 * whether the catalogue has finished loading. Right after a deploy you
 * should see ok=true, warm=false for a few seconds, then warm=true.
 */
export async function GET() {
  const snapshot = peekCatalog();

  return NextResponse.json(
    {
      ok: true,
      warm: snapshot.warm,
      cameras: snapshot.count,
      uptimeSeconds: Math.round(process.uptime()),
      sources: snapshot.sources.map((source) => ({
        key: source.key,
        cameras: source.count,
        ageSeconds: source.fetchedAt === 0 ? null : Math.round((Date.now() - source.fetchedAt) / 1000),
        error: source.error,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
