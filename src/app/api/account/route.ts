import { NextResponse } from "next/server";
import { auth, signOut } from "@/auth";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";

/**
 * Delete everything held about the signed-in account.
 *
 * This genuinely deletes rather than flagging: the user row goes, and
 * `dashboards`, `accounts` and `sessions` follow. Dashboards cascade via
 * the foreign key; the Auth.js tables are cleared explicitly because its
 * documented schema doesn't declare cascades.
 *
 * It runs in a transaction so a partial failure can't leave an account
 * that's half-deleted — orphaned sessions would be the worst outcome,
 * since those are what keep someone signed in.
 */
export async function DELETE() {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Accounts are not enabled" }, { status: 404 });

  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM dashboards WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM sessions WHERE "userId" = $1`, [userId]);
    await client.query(`DELETE FROM accounts WHERE "userId" = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[account] deletion failed:", error);
    return NextResponse.json({ error: "Deletion failed" }, { status: 500 });
  } finally {
    client.release();
  }

  // Clear the cookie too, so the browser isn't left holding a token for
  // a user row that no longer exists.
  await signOut({ redirect: false }).catch(() => {});
  return new NextResponse(null, { status: 204 });
}
