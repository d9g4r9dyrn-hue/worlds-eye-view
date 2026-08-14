import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { ensureSchema, getPool, isDatabaseConfigured } from "@/lib/db";

/**
 * Sign-in, used only to let people keep more than one saved camera wall.
 *
 * Google is the only provider on purpose, at least for now: it's free and
 * needs no review, whereas Sign in with Apple requires a paid Apple
 * Developer membership and Facebook requires App Review before public
 * use. Auth.js keeps providers pluggable, so adding either later is a few
 * lines here plus their credentials.
 *
 * The whole thing is optional. With no DATABASE_URL or no Google
 * credentials configured, `authEnabled` is false, the UI hides sign-in
 * entirely, and the map works exactly as it did before — dashboards just
 * stay in localStorage. That matters because the map is the product and
 * it should never be gated behind an account.
 */

export const authEnabled =
  isDatabaseConfigured() && Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  // Building the adapter lazily keeps `pg` from being constructed at
  // import time, which would throw during the build when DATABASE_URL
  // isn't present.
  adapter: isDatabaseConfigured() ? PostgresAdapter(getPool()) : undefined,

  providers: authEnabled
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          // Only what's needed to identify the account. No Drive, no
          // contacts, no offline access — the consent screen should be
          // boring, because the app genuinely doesn't want anything else.
          authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
        }),
      ]
    : [],

  // Database sessions rather than JWTs: sessions can then be revoked
  // server-side, which is what makes "delete my account" actually mean
  // something rather than leaving a valid token in the wild.
  session: { strategy: "database", maxAge: 60 * 60 * 24 * 30 },

  pages: { signIn: "/", error: "/" },

  callbacks: {
    async session({ session, user }) {
      if (session.user) session.user.id = String(user.id);
      return session;
    },
  },

  events: {
    async signIn() {
      // Cheap and idempotent; guarantees the tables exist before the
      // adapter's first write on a fresh database.
      await ensureSchema().catch(() => {});
    },
  },
}));
