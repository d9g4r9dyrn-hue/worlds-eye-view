import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import type { PublicCam } from "@/lib/cams/types";

/**
 * Saved camera walls, one row per dashboard, scoped to the signed-in user.
 *
 * Every query filters on user_id from the session — never from anything
 * the client sends — so one account can't read or write another's walls
 * even by guessing an id.
 */

/** Keeps a single wall from being used to store arbitrary bulk data. */
const MAX_CAMS_PER_DASHBOARD = 64;
const MAX_DASHBOARDS = 25;
const MAX_NAME_LENGTH = 60;

export interface DashboardRow {
  id: number;
  name: string;
  cams: PublicCam[];
  columns: number | null;
  updatedAt: string;
  /** Virtual folder path, "" for the root. See cleanFolder. */
  folder: string;
  isPublic: boolean;
}

/**
 * Stores only the fields the wall actually renders. The client sends
 * whole camera objects, and without this a future field on PublicCam
 * would silently start being persisted — this keeps what lands in the
 * database deliberate.
 */
function sanitiseCams(input: unknown): PublicCam[] {
  if (!Array.isArray(input)) return [];
  const cams: PublicCam[] = [];

  for (const raw of input.slice(0, MAX_CAMS_PER_DASHBOARD)) {
    if (!raw || typeof raw !== "object") continue;
    const cam = raw as Partial<PublicCam>;
    if (typeof cam.id !== "string" || typeof cam.lat !== "number" || typeof cam.lon !== "number") continue;

    cams.push({
      id: cam.id,
      title: String(cam.title ?? "Camera").slice(0, 200),
      place: cam.place == null ? null : String(cam.place).slice(0, 120),
      country: cam.country == null ? null : String(cam.country).slice(0, 80),
      lat: cam.lat,
      lon: cam.lon,
      category: (cam.category ?? "traffic") as PublicCam["category"],
      prominence: Number(cam.prominence) || 1,
      refreshSeconds: Number(cam.refreshSeconds) || 300,
      sourcePage: cam.sourcePage == null ? null : String(cam.sourcePage).slice(0, 400),
      provider: String(cam.provider ?? "").slice(0, 120),
    });
  }

  return cams;
}

function cleanName(input: unknown, fallback: string): string {
  const name = String(input ?? "").trim();
  return (name || fallback).slice(0, MAX_NAME_LENGTH);
}

/** Depth cap. Deep enough for /sunsets/europe/italy, shallow enough that
 *  the tree stays navigable in a dropdown. */
const MAX_FOLDER_DEPTH = 4;
const MAX_SEGMENT_LENGTH = 40;

/**
 * Normalises a folder path to a canonical form: no leading or trailing
 * slash, no empty or duplicated segments, no "." or "..".
 *
 * The path is only ever a label - nothing resolves it against a
 * filesystem - but it is also user input that gets displayed and grouped
 * on, so it is normalised once here rather than defended against
 * everywhere it is read. Rejecting ".." matters less for traversal than
 * for the fact that two spellings of the same folder would otherwise
 * appear as two folders.
 */
export function cleanFolder(input: unknown): string {
  if (typeof input !== "string") return "";
  const segments = input
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .slice(0, MAX_FOLDER_DEPTH)
    .map((segment) => segment.slice(0, MAX_SEGMENT_LENGTH));
  return segments.join("/");
}

async function requireUser() {
  if (!isDatabaseConfigured()) return null;
  const user = await currentUser();
  // Verified accounts only. An unverified one has proved nothing about
  // the address it claims, and letting it accumulate saved walls would
  // make the confirmation step optional in practice.
  return user && user.emailVerified ? user.id : null;
}

export async function GET() {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ dashboards: [] }, { status: 200 });

  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, name, cams, columns, updated_at, folder, is_public
       FROM dashboards WHERE user_id = $1 ORDER BY folder ASC, updated_at DESC`,
    [userId]
  );

  const dashboards: DashboardRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    cams: row.cams ?? [],
    columns: row.columns,
    updatedAt: row.updated_at,
    folder: row.folder ?? "",
    isPublic: Boolean(row.is_public),
  }));

  return NextResponse.json({ dashboards }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await ensureSchema();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    cams?: unknown;
    columns?: number | null;
    folder?: string;
  };

  const { rows: countRows } = await getPool().query(`SELECT COUNT(*)::int AS n FROM dashboards WHERE user_id = $1`, [
    userId,
  ]);
  if (countRows[0].n >= MAX_DASHBOARDS) {
    return NextResponse.json({ error: `Limit of ${MAX_DASHBOARDS} dashboards reached` }, { status: 409 });
  }

  const columns = Number.isFinite(body.columns) ? Math.min(12, Math.max(1, Number(body.columns))) : null;

  const { rows } = await getPool().query(
    `INSERT INTO dashboards (user_id, name, cams, columns, folder)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id, name, cams, columns, updated_at, folder, is_public`,
    [
      userId,
      cleanName(body.name, "Untitled wall"),
      JSON.stringify(sanitiseCams(body.cams)),
      columns,
      cleanFolder(body.folder),
    ]
  );

  const row = rows[0];
  return NextResponse.json(
    {
      dashboard: {
        id: row.id,
        name: row.name,
        cams: row.cams,
        columns: row.columns,
        updatedAt: row.updated_at,
        folder: row.folder ?? "",
        isPublic: Boolean(row.is_public),
      },
    },
    { status: 201 }
  );
}
