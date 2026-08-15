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

  -- Password sign-in. Added as an ALTER rather than folded into the
  -- CREATE above so an existing deployment picks it up: CREATE TABLE IF
  -- NOT EXISTS does nothing to a table that already exists, so a column
  -- added to that literal would never appear on the live database.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

  -- Case-insensitive uniqueness. Email addresses are not case sensitive
  -- in practice, and without this "Cort@x.com" and "cort@x.com" become
  -- two accounts that each believe they own the address.
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

  /*
   * Folders are a path string on the dashboard, not a table.
   *
   * The requirement is nesting like /sunsets/italy, per user, where a
   * folder has no properties of its own - no sharing, no permissions,
   * nothing to hang off a row. A folder table would mean a self-
   * referencing parent_id, recursive queries to render a tree, orphan
   * cleanup on delete, and a second round trip on every read, all to
   * store text that is already in the dashboard row. The tree is derived
   * from the paths at render time instead.
   *
   * Empty string is the root, so the column is never null and every
   * query can group on it without a COALESCE.
   */
  ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '';

  CREATE INDEX IF NOT EXISTS dashboards_user_folder_idx ON dashboards(user_id, folder);

  /*
   * Publishing. Private by default, and the default is the important
   * part: a wall becomes visible to the world only by an explicit act,
   * never by omission.
   *
   * Note what is NOT published along with it. The folder is the owner's
   * filing, not part of the artefact - someone who files a wall under
   * /work/clients/acme before publishing it has not agreed to tell
   * anyone they have a client called Acme. Public listings expose the
   * name and the cameras and nothing else.
   *
   * The index is partial: public walls are the small minority that get
   * scanned by the gallery, and there is no point indexing millions of
   * private rows that no query will ever ask for by this column.
   */
  ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

  CREATE INDEX IF NOT EXISTS dashboards_public_idx
    ON dashboards(published_at DESC) WHERE is_public;

  /*
   * Sessions and verification tokens are stored as SHA-256 hashes.
   *
   * A session token is a bearer credential: anyone holding one is the
   * user. Storing them raw means a leaked database backup, a stray log
   * line, or SQL injection hands over live sessions rather than useless
   * strings. Hashing costs one cheap digest per request and removes that
   * entire class of consequence. SHA-256 rather than a password KDF is
   * correct here precisely because these are 256 bits of real randomness
   * - there is nothing to brute-force, so the slowness that protects a
   * human-chosen password would buy nothing.
   */
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens(user_id, purpose);
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
