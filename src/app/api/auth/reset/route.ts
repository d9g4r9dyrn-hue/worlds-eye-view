import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/auth/passwords";
import { consumeEmailToken, createSession, destroyAllSessions } from "@/lib/auth/session";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Set a new password from a reset link.
 *
 * Every other session is destroyed on success. If the reset was prompted
 * by someone else having got in, changing the password while leaving
 * their session alive would accomplish nothing — this is the moment that
 * makes revocable database sessions worth having over a JWT.
 */
const RATE_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't enabled here." }, { status: 503 });
  }

  const rate = checkRateLimit(request, "reset", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");

  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await ensureSchema();

  const userId = await consumeEmailToken(token, "reset_password");
  if (!userId) {
    return NextResponse.json(
      { error: "That link has expired or already been used. Ask for a new one." },
      { status: 400 }
    );
  }

  const hash = await hashPassword(password);
  await getPool().query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);

  // Order matters: drop every existing session first, then issue the one
  // for this browser, so the person resetting stays signed in and
  // everyone else is turned out.
  await destroyAllSessions(userId);
  await createSession(userId);

  return NextResponse.json({ ok: true });
}
