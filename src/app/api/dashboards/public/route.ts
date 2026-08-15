import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import type { PublicCam } from "@/lib/cams/types";

/**
 * Published camera walls, readable by anyone.
 *
 * The only endpoint in the dashboards family that does not ask who you
 * are, and the only one that reads rows belonging to other people. Both
 * of those make it the one worth being careful about, so the care is
 * concentrated in the SELECT: it names its columns explicitly and is
 * filtered on `is_public`, which means adding a private column to the
 * table later cannot silently start publishing it.
 *
 * There is no POST, PATCH or DELETE here. A guest can look and nothing
 * else; publishing is an action taken by the owner through the
 * authenticated routes.
 */

const PAGE_SIZE = 40;

export interface PublicDashboard {
  id: number;
  name: string;
  cams: PublicCam[];
  columns: number | null;
  publishedAt: string | null;
  /** Display name of whoever published it, or null if they gave none. */
  author: string | null;
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ dashboards: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const url = new URL(request.url);
  const limit = Math.min(PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE));

  await ensureSchema();

  /*
   * Note what is selected and what is not. The owner's email is never
   * read - a wall being public says nothing about wanting the address
   * that published it to be public - and neither is `folder`, which is
   * the owner's private filing rather than part of the artefact.
   */
  const { rows } = await getPool().query(
    `SELECT d.id, d.name, d.cams, d.columns, d.published_at, u.name AS author
       FROM dashboards d
       JOIN users u ON u.id = d.user_id
      WHERE d.is_public
      ORDER BY d.published_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );

  const dashboards: PublicDashboard[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    cams: row.cams ?? [],
    columns: row.columns,
    publishedAt: row.published_at,
    author: row.author ?? null,
  }));

  return NextResponse.json(
    { dashboards },
    // Briefly cacheable: this is the same answer for every visitor, and
    // a newly published wall appearing within the minute is fine.
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
  );
}
