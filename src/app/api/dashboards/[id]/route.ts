import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import type { PublicCam } from "@/lib/cams/types";

/**
 * Update, rename or delete one saved wall.
 *
 * Every statement carries `AND user_id = $n`. The id in the URL is
 * therefore never sufficient on its own — a request for someone else's
 * dashboard matches zero rows and comes back 404, which is the same
 * answer as an id that doesn't exist. That's deliberate: it avoids
 * telling a prober which ids are real.
 */

const MAX_CAMS_PER_DASHBOARD = 64;
const MAX_NAME_LENGTH = 60;

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

async function requireUser() {
  if (!isDatabaseConfigured()) return null;
  const user = await currentUser();
  // Verified accounts only. An unverified one has proved nothing about
  // the address it claims, and letting it accumulate saved walls would
  // make the confirmation step optional in practice.
  return user && user.emailVerified ? user.id : null;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/dashboards/[id]">) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const dashboardId = Number(id);
  if (!Number.isInteger(dashboardId)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  await ensureSchema();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    cams?: unknown;
    columns?: number | null;
  };

  // Only the fields actually present are touched, so renaming a wall
  // can't accidentally blank its cameras.
  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    values.push(String(body.name).trim().slice(0, MAX_NAME_LENGTH) || "Untitled wall");
    sets.push(`name = $${values.length}`);
  }
  if (body.cams !== undefined) {
    values.push(JSON.stringify(sanitiseCams(body.cams)));
    sets.push(`cams = $${values.length}::jsonb`);
  }
  if (body.columns !== undefined) {
    values.push(body.columns === null ? null : Math.min(12, Math.max(1, Number(body.columns))));
    sets.push(`columns = $${values.length}`);
  }

  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  sets.push("updated_at = now()");

  values.push(dashboardId, userId);
  const { rows } = await getPool().query(
    `UPDATE dashboards SET ${sets.join(", ")}
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
      RETURNING id, name, cams, columns, updated_at`,
    values
  );

  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = rows[0];
  return NextResponse.json({
    dashboard: { id: row.id, name: row.name, cams: row.cams, columns: row.columns, updatedAt: row.updated_at },
  });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/dashboards/[id]">) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const dashboardId = Number(id);
  if (!Number.isInteger(dashboardId)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  await ensureSchema();
  const { rowCount } = await getPool().query(`DELETE FROM dashboards WHERE id = $1 AND user_id = $2`, [
    dashboardId,
    userId,
  ]);

  if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
