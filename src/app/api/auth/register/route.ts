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

  const existing = await pool.query(
    `SELECT id, password_hash, "emailVerified" FROM users WHERE LOWER(email) = $1`,
    [email]
  );

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
    const verified = Boolean(existing.rows[0].emailVerified);

    /*
     * An *unverified* account has no proven owner.
     *
     * Nobody has yet demonstrated control of this address, so the row
     * is not yet anybody's property and re-registering simply takes it
     * over: the new password replaces the old and a fresh link goes
     * out. That cannot harm a real owner, because a real owner would
     * have verified — and without it, an account whose first email was
     * lost, mistyped or filtered is stuck forever with no way back,
     * which is the far more likely and far worse outcome.
     *
     * It also covers the case of an account created by an earlier
     * Google sign-in, which has no password at all.
     */
    if (!verified) {
      const hash = await hashPassword(password);
      await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
      const token = await createEmailToken(userId, "verify_email");
      await sendVerificationEmail(email, token).catch((error) =>
        console.warn("[auth] verification email failed:", error)
      );
      return sameAnswer;
    }

    // Verified, and therefore genuinely someone's. Send nothing and say
    // the same thing: this is most likely a person who forgot they had
    // an account, and the answer must not differ from the new-account
    // case or it becomes an oracle. Resetting their password from an
    // unauthenticated form is exactly what must not happen here.
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
