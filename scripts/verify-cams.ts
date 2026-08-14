/**
 * Health check for the World's Eye View camera sources.
 *
 * Public webcams rot constantly — a state retires a feed, an agency moves
 * its buckets, a scraped page changes shape — and every one of those
 * failures is silent on the map (a thumbnail that doesn't load just
 * disappears). This walks each source, reports what it returned, and
 * samples real frames to prove the image URLs still resolve.
 *
 *   npm run cams:verify           # roster + a small frame sample per source
 *   npm run cams:verify -- --frames=25
 *
 * Run it when a region looks emptier than it should, or before trusting a
 * newly added source.
 */

import { caltransSource } from "../src/lib/cams/sources/caltrans";
import { oneStop511Source } from "../src/lib/cams/sources/onestop511";
import { tflSource } from "../src/lib/cams/sources/tfl";
import { digitrafficSource } from "../src/lib/cams/sources/digitraffic";
import { nztaSource } from "../src/lib/cams/sources/nzta";
import { driveBcSource } from "../src/lib/cams/sources/drivebc";
import { singaporeSource } from "../src/lib/cams/sources/singapore";
import { hongKongSource } from "../src/lib/cams/sources/hongkong";
import { avoSource } from "../src/lib/cams/sources/avo";
import { windySource } from "../src/lib/cams/sources/windy";
import { curatedSource, PROMOTIONS } from "../src/lib/cams/sources/curated";
import type { Cam, CamSource } from "../src/lib/cams/types";

const SOURCES: CamSource[] = [
  curatedSource,
  avoSource,
  caltransSource,
  oneStop511Source,
  tflSource,
  digitrafficSource,
  nztaSource,
  driveBcSource,
  hongKongSource,
  singaporeSource,
  windySource,
];

function readFlag(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Even sampling across the roster, so a source isn't judged on one corner of one state. */
function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

async function checkFrame(cam: Cam): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(cam.stillUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };

    // Mirrors the proxy's rule (see thumbCache.fetchUpstream): reject an
    // obviously textual body, but don't demand image/*. Singapore serves
    // real JPEGs as application/octet-stream, and an image/* allowlist
    // here reported an entire working country as dead.
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("text/") || type.includes("json") || type.includes("xml")) {
      return { ok: false, detail: `content-type ${type}` };
    }

    const bytes = (await response.arrayBuffer()).byteLength;
    if (bytes === 0) return { ok: false, detail: "empty body" };
    return { ok: true, detail: `${type}, ${(bytes / 1024).toFixed(0)}KB` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const framesPerSource = readFlag("frames", 8);
  const allCams: Cam[] = [];
  let anyFailure = false;

  for (const source of SOURCES) {
    process.stdout.write(`\n${source.label} (${source.key})\n`);
    const startedAt = Date.now();

    let cams: Cam[];
    try {
      cams = await source.fetchCams();
    } catch (error) {
      anyFailure = true;
      console.log(`  ROSTER FAILED: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    const elapsed = Date.now() - startedAt;
    console.log(`  roster: ${cams.length} cameras in ${elapsed}ms`);

    if (cams.length === 0) {
      // Two of these are expected rather than alarming: Windy without a
      // key, and the curated source, whose standalone list is empty by
      // design (its real content is the promotions checked at the end).
      if (source.key === "windy" && !process.env.WINDY_API_KEY) {
        console.log("  (no WINDY_API_KEY set — skipped)");
      } else if (source.key === "curated") {
        console.log("  (no standalone cameras — curation is via PROMOTIONS, checked below)");
      } else {
        console.log("  WARNING: source returned nothing");
        anyFailure = true;
      }
      continue;
    }

    allCams.push(...cams);

    const countries = new Set(cams.map((cam) => cam.country ?? "?"));
    console.log(`  coverage: ${[...countries].join(", ")}`);

    if (framesPerSource === 0) continue;

    const picks = sample(cams, framesPerSource);
    const results = await Promise.all(picks.map(checkFrame));
    const healthy = results.filter((result) => result.ok).length;
    console.log(`  frames:  ${healthy}/${picks.length} fetched`);

    for (const [index, result] of results.entries()) {
      if (result.ok) continue;
      console.log(`    DEAD ${picks[index].id} — ${result.detail}`);
    }

    // Individual dead cameras are normal; a source where most of the
    // sample fails is a broken adapter.
    if (healthy * 2 < picks.length) {
      anyFailure = true;
      console.log("  WARNING: majority of sampled frames failed — adapter may be broken");
    }
  }

  console.log(`\nTotal catalogue: ${allCams.length} cameras`);

  // A promotion that no longer matches anything is invisible on the map —
  // the camera just quietly reverts to its feed name and low rank.
  const ids = new Set(allCams.map((cam) => cam.id));
  const orphans = Object.keys(PROMOTIONS).filter((id) => !ids.has(id));
  if (orphans.length > 0) {
    anyFailure = true;
    console.log(`\nStale promotions in curated.ts (id no longer in any feed):`);
    for (const id of orphans) console.log(`  ${id}`);
  } else {
    console.log(`All ${Object.keys(PROMOTIONS).length} curated promotions matched a live camera.`);
  }

  process.exit(anyFailure ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
