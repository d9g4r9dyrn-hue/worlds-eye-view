import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/db";

/**
 * Who, if anyone, is signed in.
 *
 * The client can't read the session cookie — it's httpOnly, which is the
 * point — so this is how the UI learns whether to show an account menu
 * or a sign-in form.
 *
 * Never cached. A stale "signed in" here would render the account menu
 * for someone who has just signed out.
 */
export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ accountsEnabled: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const user = await currentUser().catch(() => null);

  return NextResponse.json(
    {
      accountsEnabled: true,
      // Deliberately not the whole row: the client has no use for the
      // password hash or the session's expiry, so they don't leave here.
      user: user ? { id: user.id, email: user.email, name: user.name } : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
