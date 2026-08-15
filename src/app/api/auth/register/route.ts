import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/auth/passwords";
import { createEmailToken } from "@/lib/auth/session";
import { sendVerificationEmail } from "@/lib/auth/email";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Create an account.
 *
 * Note what this does NOT do: it does not sign you in. Verifying the
 * address is what proves the account is yours, and handing out a session
 * before that would make the verification step decorative.
 */
const RATE_LIMIT = { limit: 5, windowMs: 15 * 60_000 };

/** Deliberately loose. Real address validity is proven by the email
 *  arriving, not by a regex, and elaborate patterns mostly reject valid
 *  unusual addresses. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't enabled here." }, { status: 503 });
  }

  const rate = checkRateLimit(request, "register", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 80) || null;

  if (!EMAIL_SHAPE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await ensureSchema();
  const pool = getPool();

  const existing = await pool.query(`SELECT id, password_hash FROM users WHERE LOWER(email) = $1`, [
    email,
  ]);

  /**
   * Always the same answer, whether or not the address is already
   * registered.
   *
   * Saying "that email is taken" turns this endpoint into an oracle for
   * whether any given person has an account here — which is exactly the
   * kind of thing that matters to someone who would rather their family
   * not know. The person who genuinely owns the address finds out via
   * the email they receive, which differs depending on the case.
   */
  const sameAnswer = NextResponse.json({
    ok: true,
    message: "Check your email for a link to confirm the address.",
  });

  if (existing.rows[0]) {
    const userId = Number(existing.rows[0].id);
    // An account that exists but has no password is one created by an
    // earlier Google sign-in; setting a password on it is a legitimate
    // thing to want, and the emailed link is what authorises it.
    if (!existing.rows[0].password_hash) {
      const hash = await hashPassword(password);
      await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
      const token = await createEmailToken(userId, "verify_email");
      await sendVerificationEmail(email, token).catch((error) =>
        console.warn("[auth] verification email failed:", error)
      );
    }
    // Otherwise: send nothing, say the same thing. A silent no-op is the
    // right behaviour for what is most likely someone who forgot they
    // already registered — they can use "forgot password".
    return sameAnswer;
  }

  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, name, hash]
  );
  const userId = Number(rows[0].id);

  const token = await createEmailToken(userId, "verify_email");
  await sendVerificationEmail(email, token).catch((error) =>
    console.warn("[auth] verification email failed:", error)
  );

  return sameAnswer;
}
