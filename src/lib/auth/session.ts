import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";

/**
 * Sessions: an opaque random token in an httpOnly cookie, hashed at rest.
 *
 * No JWT. The whole reason for owning this rather than taking Auth.js's
 * credentials path is that a JWT cannot be revoked — "sign out
 * everywhere" and "delete my account" are only real if the server can
 * make an existing credential stop working, and that requires state.
 * With a row per session, deleting the row ends the session immediately.
 */

const COOKIE_NAME = "wev_session";
const SESSION_DAYS = 30;
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/** Issues a session and sets the cookie. Returns nothing — the caller
 *  should not need the raw token, and not returning it keeps it from
 *  being logged or serialised into a response by accident. */
export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await getPool().query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [hashToken(token), userId, expiresAt]
  );

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    // Set in production only: on localhost there is no HTTPS, and a
    // secure cookie would simply never be stored, making sign-in appear
    // to succeed and then silently not work.
    secure: process.env.NODE_ENV === "production",
    // Lax rather than Strict: Strict withholds the cookie on the
    // top-level navigation back from the email verification link, so the
    // user would arrive at their own verified account logged out.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * The signed-in user, or null.
 *
 * Expired rows are deleted on encounter rather than by a scheduled
 * sweep — the row is already in hand, and a cleanup job is one more
 * thing to run and forget to run.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const { rows } = await getPool().query(
    `SELECT s.expires_at, u.id, u.email, u.name, u."emailVerified"
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)]
  );

  const row = rows[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await getPool()
      .query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [hashToken(token)])
      .catch(() => {});
    return null;
  }

  return {
    id: Number(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : null,
    emailVerified: Boolean(row.emailVerified),
  };
}

/** Ends this session only. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await getPool()
      .query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [hashToken(token)])
      .catch(() => {});
  }
  store.delete(COOKIE_NAME);
}

/** Ends every session for a user — password change, or "sign out everywhere". */
export async function destroyAllSessions(userId: number): Promise<void> {
  await getPool().query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
}

/* ---------------------------------------------------------------- tokens */

export type TokenPurpose = "verify_email" | "reset_password";

const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  // Long enough to survive an email sitting unread overnight.
  verify_email: 60 * 24,
  // Deliberately short: a reset link is a full account takeover in one
  // click if it is found later in an inbox or a shared browser.
  reset_password: 60,
};

/**
 * Mints a single-use token and returns the raw value for emailing. Only
 * its hash is stored, so a database leak yields nothing usable.
 */
export async function createEmailToken(userId: number, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES[purpose] * 60_000);

  // One live token per purpose per user: minting a new one invalidates
  // the old, so a forwarded or intercepted earlier link goes dead as
  // soon as the user asks for another.
  await getPool().query(`DELETE FROM email_tokens WHERE user_id = $1 AND purpose = $2`, [
    userId,
    purpose,
  ]);
  await getPool().query(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [hashToken(token), userId, purpose, expiresAt]
  );

  return token;
}

/** Consumes a token, returning the user id it belonged to. Single use. */
export async function consumeEmailToken(
  token: string,
  purpose: TokenPurpose
): Promise<number | null> {
  const { rows } = await getPool().query(
    `DELETE FROM email_tokens
      WHERE token_hash = $1 AND purpose = $2 AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token), purpose]
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}
