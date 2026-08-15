import { NextResponse } from "next/server";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * Sign in.
 *
 * Rate limited hard, because this is the one endpoint where guessing is
 * the attack. The limit is per client per window; it is not a complete
 * defence against a distributed attempt, but combined with scrypt's cost
 * it makes online guessing hopeless, which is the part that is ours to
 * solve.
 */
const RATE_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

/**
 * A hash to check against when the account doesn't exist.
 *
 * Without this, a missing account returns in about a millisecond while a
 * real one takes the full scrypt cost, and the difference is a clean
 * signal for enumerating which addresses are registered. Verifying
 * against a throwaway hash spends the same time on both paths. Computed
 * once, lazily, because it costs ~128MB and 100ms to make.
 */
let decoyHash: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword("decoy password, never matches anything");
  return decoyHash;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Accounts aren't enabled here." }, { status: 503 });
  }

  const rate = checkRateLimit(request, "login", RATE_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { ...rateLimitHeaders(rate), "Retry-After": String(rate.retryAfter) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, password_hash, "emailVerified" FROM users WHERE LOWER(email) = $1`,
    [email]
  );

  const row = rows[0];
  const stored = row?.password_hash as string | null | undefined;

  const matched = stored
    ? await verifyPassword(password, stored)
    : // Burn the same time as a real check before failing.
      await verifyPassword(password, await getDecoyHash());

  // One message for "no such account", "wrong password", and "account
  // exists but has no password" — see the register route on why.
  if (!row || !stored || !matched) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  if (!row.emailVerified) {
    return NextResponse.json(
      { error: "Confirm your email address first — check your inbox for the link.", unverified: true },
      { status: 403 }
    );
  }

  await createSession(Number(row.id));
  return NextResponse.json({ ok: true });
}
