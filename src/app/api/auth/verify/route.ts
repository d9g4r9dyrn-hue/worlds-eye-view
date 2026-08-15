import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { consumeEmailToken, createSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Confirm an email address.
 *
 * Signs the user in on success. They have just proven they control the
 * address by following a link only that inbox received, which is a
 * stronger claim than the password they are about to be asked for
 * otherwise — making them type it again here would be ceremony.
 */
const RATE_LIMIT = { limit: 20, windowMs: 15 * 60_000 };

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't enabled here." }, { status: 503 });
  }

  const rate = checkRateLimit(request, "verify", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = String(body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  await ensureSchema();

  const userId = await consumeEmailToken(token, "verify_email");
  if (!userId) {
    return NextResponse.json(
      { error: "That link has expired or already been used. Sign in to send a new one." },
      { status: 400 }
    );
  }

  await getPool().query(`UPDATE users SET "emailVerified" = now() WHERE id = $1`, [userId]);
  await createSession(userId);

  return NextResponse.json({ ok: true });
}
