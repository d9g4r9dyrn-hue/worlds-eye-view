import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/db";

/**
 * Sign out.
 *
 * POST rather than GET so that a link or an image tag on some other site
 * can't sign people out by being loaded — the same reasoning that makes
 * any state change a POST, applied to the smallest possible one.
 */
export async function POST() {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: true });
  await destroySession();
  return NextResponse.json({ ok: true });
}
