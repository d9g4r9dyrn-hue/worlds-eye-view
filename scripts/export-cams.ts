/**
 * Dumps the whole camera catalogue to CSV, plus a coverage summary.
 *
 * Built for finding the holes: the per-country summary is the useful
 * output, because it shows at a glance where a continent is represented
 * by three cameras and therefore where another free source would be worth
 * hunting for.
 *
 *   npm run cams:export                  # writes ./cams-export.csv + ./cams-coverage.csv
 *   npm run cams:export -- --out=path    # choose a different location
 *
 * Reads WINDY_API_KEY from the environment if present, exactly as the app
 * does; without it the Windy rows are simply absent.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
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
import type { Cam, CamSource } from "../src/lib/cams/types";

const SOURCES: CamSource[] = [
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

/** Titles routinely contain commas and quotes; both have to survive a round trip. */
function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 place names (Kilauea, Jyväskylä) correctly
  // instead of mojibake.
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Very coarse continent bucketing from coordinates alone.
 *
 * Deliberately crude — it exists to answer "which large areas are thin?",
 * not to be a geography library. Boxes overlap in places and the nearest
 * match wins; a handful of cameras land in the wrong bucket and that
 * doesn't change the conclusion.
 */
function continentOf(lat: number, lon: number): string {
  if (lat > 12 && lon > -170 && lon < -50) return "North America";
  if (lat <= 12 && lat > -60 && lon > -85 && lon < -30) return "South America";
  if (lat > 35 && lon >= -25 && lon < 45) return "Europe";
  if (lat <= 37 && lat > -35 && lon >= -20 && lon < 52) return "Africa";
  if (lat > 5 && lon >= 45 && lon < 180) return "Asia";
  if (lat <= 5 && lat > -50 && lon >= 110 && lon < 180) return "Oceania";
  if (lat <= -50) return "Antarctic";
  return "Other";
}

async function main() {
  const outFlag = process.argv.find((arg) => arg.startsWith("--out="));
  const outPath = outFlag ? outFlag.split("=")[1] : path.resolve(process.cwd(), "cams-export.csv");
  const coveragePath = outPath.replace(/\.csv$/i, "") + "-coverage.csv";

  const cams: Cam[] = [];
  for (const source of SOURCES) {
    process.stdout.write(`fetching ${source.key}… `);
    try {
      const batch = await source.fetchCams();
      cams.push(...batch);
      console.log(`${batch.length}`);
    } catch (error) {
      console.log(`FAILED (${error instanceof Error ? error.message : error})`);
    }
  }

  cams.sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "") || a.title.localeCompare(b.title));

  writeFileSync(
    outPath,
    csvRows([
      ["id", "title", "place", "country", "continent", "category", "provider", "lat", "lon", "refresh_seconds"],
      ...cams.map((cam) => [
        cam.id,
        cam.title,
        cam.place ?? "",
        cam.country ?? "",
        continentOf(cam.lat, cam.lon),
        cam.category,
        cam.provider,
        cam.lat.toFixed(6),
        cam.lon.toFixed(6),
        cam.refreshSeconds,
      ]),
    ]),
    "utf8"
  );

  // --- coverage summary, the part that actually shows the gaps ---
  const byCountry = new Map<string, { continent: string; count: number; categories: Map<string, number> }>();
  for (const cam of cams) {
    const key = cam.country ?? "(unknown)";
    let entry = byCountry.get(key);
    if (!entry) {
      entry = { continent: continentOf(cam.lat, cam.lon), count: 0, categories: new Map() };
      byCountry.set(key, entry);
    }
    entry.count++;
    entry.categories.set(cam.category, (entry.categories.get(cam.category) ?? 0) + 1);
  }

  const countryRows = [...byCountry.entries()].sort((a, b) => b[1].count - a[1].count);
  writeFileSync(
    coveragePath,
    csvRows([
      ["country", "continent", "cameras", "categories"],
      ...countryRows.map(([country, entry]) => [
        country,
        entry.continent,
        entry.count,
        [...entry.categories.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([category, n]) => `${category}:${n}`)
          .join(" "),
      ]),
    ]),
    "utf8"
  );

  const byContinent = new Map<string, number>();
  for (const cam of cams) {
    const continent = continentOf(cam.lat, cam.lon);
    byContinent.set(continent, (byContinent.get(continent) ?? 0) + 1);
  }

  console.log(`\n${cams.length} cameras across ${byCountry.size} countries`);
  console.log(`  ${outPath}`);
  console.log(`  ${coveragePath}\n`);
  console.log("Coverage by continent (the thin ones are where to hunt):");
  for (const [continent, count] of [...byContinent.entries()].sort((a, b) => b[1] - a[1])) {
    const bar = "#".repeat(Math.max(1, Math.round(Math.log10(count + 1) * 8)));
    console.log(`  ${continent.padEnd(15)} ${String(count).padStart(6)}  ${bar}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
