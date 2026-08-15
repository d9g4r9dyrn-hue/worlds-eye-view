import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { createEmailToken } from "@/lib/auth/session";
import { sendPasswordResetEmail } from "@/lib/auth/email";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Ask for a password reset link.
 *
 * Answers identically whether or not the address has an account, for the
 * same reason registration does — otherwise this is a cleaner account
 * oracle than either of the other two, since it takes only an email.
 *
 * Only verified accounts get a link. An unverified one is recoverable by
 * simply registering again (see the register route), and sending reset
 * mail to an address nobody has proven they control would be sending it
 * to a stranger.
 */
const RATE_LIMIT = { limit: 5, windowMs: 15 * 60_000 };

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't enabled here." }, { status: 503 });
  }

  const rate = checkRateLimit(request, "forgot", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();

  const sameAnswer = NextResponse.json({
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  });

  if (!email) return sameAnswer;

  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id FROM users WHERE LOWER(email) = $1 AND "emailVerified" IS NOT NULL`,
    [email]
  );

  const row = rows[0];
  if (row) {
    const token = await createEmailToken(Number(row.id), "reset_password");
    await sendPasswordResetEmail(email, token).catch((error) =>
      console.warn("[auth] reset email failed:", error)
    );
  }

  return sameAnswer;
}
