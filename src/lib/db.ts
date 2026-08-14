import { Pool } from "pg";

/**
 * Postgres, used for exactly two things: sign-in state and saved
 * dashboards.
 *
 * The camera catalogue deliberately does NOT live here — it stays in
 * memory and rebuilds on boot, which is what lets the app restart
 * cleanly and scale without a volume. If this database is unreachable
 * the map still works completely; you just can't sign in or load a saved
 * dashboard. That separation is worth preserving.
 */

const globalForDb = globalThis as typeof globalThis & {
  __wevPool?: Pool;
  __wevMigrated?: Promise<void>;
};

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Pooled, and pinned to globalThis for the same reason the camera
 * registry is: Next can compile a shared module into more than one
 * server bundle, and a pool per bundle would multiply real Postgres
 * connections for no reason.
 */
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  globalForDb.__wevPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    // Railway's private network doesn't need TLS, and its certificate
    // wouldn't validate against the internal hostname anyway.
    ssl: process.env.DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  return globalForDb.__wevPool;
}

/**
 * Creates the schema if it isn't there.
 *
 * The `users`/`accounts`/`sessions`/`verification_token` tables are the
 * shape @auth/pg-adapter expects — they're its documented schema rather
 * than anything invented here, so don't rename columns.
 *
 * `dashboards` is ours. Cameras are stored as a JSON array rather than a
 * join table on purpose: a dashboard is an ordered list that's always
 * read and written whole, never queried across, and the order is part of
 * the data (see the drag-to-rearrange feature). A join table would add a
 * position column and a lot of ceremony to model the same thing worse.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS verification_token (
    identifier TEXT NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (identifier, token)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL,
    "userId" INTEGER NOT NULL,
    type VARCHAR(255) NOT NULL,
    provider VARCHAR(255) NOT NULL,
    "providerAccountId" VARCHAR(255) NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at BIGINT,
    id_token TEXT,
    scope TEXT,
    session_state TEXT,
    token_type TEXT,
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL,
    "userId" INTEGER NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    "sessionToken" VARCHAR(255) NOT NULL,
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL,
    name VARCHAR(255),
    email VARCHAR(255),
    "emailVerified" TIMESTAMPTZ,
    image TEXT,
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS dashboards (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cams JSONB NOT NULL DEFAULT '[]'::jsonb,
    columns INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS dashboards_user_idx ON dashboards(user_id);
`;

/**
 * Runs once per process. Held as a promise so concurrent first requests
 * wait on the same migration rather than racing to create the tables.
 */
export function ensureSchema(): Promise<void> {
  globalForDb.__wevMigrated ??= (async () => {
    const pool = getPool();
    await pool.query(SCHEMA);
  })().catch((error) => {
    // Clear the cached promise so a transient failure can be retried on
    // the next request rather than poisoning the process forever.
    globalForDb.__wevMigrated = undefined;
    throw error;
  });

  return globalForDb.__wevMigrated;
}
