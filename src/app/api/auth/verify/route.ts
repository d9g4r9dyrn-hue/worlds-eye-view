import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { consumeEmailToken, createSession, peekEmailToken } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/passwords";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Confirm an email address.
 *
 * Takes the link AND the password chosen when that link was requested.
 * The link proves the inbox; the password proves this is the person who
 * asked for it. Both are needed, because the link alone is delivered to
 * the address whoever typed it named, and a stranger may have typed
 * somebody else's (see the register route, and the note on
 * email_tokens.password_hash in src/lib/db.ts).
 *
 * Signs the user in on success: they have just proven both things, so
 * asking them to sign in again would be ceremony.
 */
const RATE_LIMIT = { limit: 20, windowMs: 15 * 60_000 };

const DEAD_LINK = "That link has expired or already been used. Sign up again with the same email to get a new one.";

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

  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  if (!password) return NextResponse.json({ error: "Enter the password you chose when you signed up." }, { status: 400 });

  await ensureSchema();

  const pending = await peekEmailToken(token, "verify_email");
  if (!pending) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  /*
   * Links minted before this change carry no password of their own, and
   * for those the account's stored password is the same proof: the old
   * register route had already written it there. Nothing is left
   * unverifiable, and these rows are gone within a day either way.
   */
  let expected = pending.passwordHash;
  if (!expected) {
    const { rows } = await getPool().query(`SELECT password_hash FROM users WHERE id = $1`, [pending.userId]);
    expected = (rows[0]?.password_hash as string | null) ?? null;
  }
  if (!expected) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  if (!(await verifyPassword(password, expected))) {
    return NextResponse.json(
      { error: "That password doesn't match the one chosen when this link was requested." },
      { status: 400 }
    );
  }

  // Spend the token only once the password has matched, so a wrong guess
  // does not burn the link.
  const userId = await consumeEmailToken(token, "verify_email");
  if (!userId) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  const { rows } = await getPool().query(
    `UPDATE users SET password_hash = $1, "emailVerified" = COALESCE("emailVerified", now())
      WHERE id = $2 RETURNING id`,
    [expected, userId]
  );
  if (!rows[0]) return NextResponse.json({ error: DEAD_LINK }, { status: 400 });

  // Any other pending link for this account is now moot, including one a
  // stranger asked for.
  await getPool().query(`DELETE FROM email_tokens WHERE user_id = $1 AND purpose = 'verify_email'`, [userId]);
  await createSession(userId);

  return NextResponse.json({ ok: true });
}
