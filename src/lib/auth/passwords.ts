import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hand-wrapped rather than `promisify`d: promisify resolves to scrypt's
 * three-argument overload and silently drops the options object, which
 * would quietly hash everything at Node's defaults instead of the
 * parameters chosen below.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing, on scrypt from Node's own crypto module.
 *
 * argon2id would be the textbook first choice and scrypt is the
 * textbook second — both are memory-hard, both are on OWASP's
 * recommended list, and the gap between them matters far less than
 * getting the parameters and the comparison right. What decides it here
 * is that scrypt ships inside Node: every argon2 binding for Node is a
 * native module, which means a compile step or prebuilt binaries that
 * have to exist for both this Windows dev machine and Railway's Linux
 * containers. A password hash that fails to install is worth
 * considerably less than one theoretical notch of resistance.
 *
 * Parameters follow OWASP's scrypt guidance: N=2^17, r=8, p=1. That is
 * roughly 128 MB of memory per hash, which is the point — it is what
 * makes bulk offline cracking expensive. It also means this must never
 * be called concurrently without bound; see the note on maxmem below.
 */
const SCRYPT_N = 1 << 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Node's default maxmem is 32 MB and these parameters need ~128 MB, so
 * without raising this every hash throws. Set from the parameters rather
 * than hardcoded, so tuning N above can't silently break hashing.
 */
const MAX_MEM = 256 * SCRYPT_N * SCRYPT_R;

/** `scrypt$N$r$p$salt$hash`, all base64url. Self-describing so the
 *  parameters can be raised later without stranding existing hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification against a stored hash.
 *
 * Reads the parameters out of the stored string rather than assuming the
 * current constants, so raising the cost later leaves everyone still
 * able to log in with their old hash.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = (await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    })) as Buffer;
  } catch {
    // Stored parameters that this Node build refuses (absurd N, say)
    // are a failed verification, not a crash.
    return false;
  }

  // Lengths are equal by construction above, so timingSafeEqual is safe
  // to call without leaking via a length check.
  return timingSafeEqual(derived, expected);
}

/**
 * The minimum that actually helps.
 *
 * Length is the only rule here, deliberately. Composition rules
 * ("one uppercase, one symbol") measurably push people toward
 * `Password1!` and its cousins, which is exactly the shape of a
 * cracking dictionary; length is what buys real entropy. NIST dropped
 * composition requirements for the same reason.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // Bounded because scrypt hashes whatever it is given, and an
  // unbounded input is an easy way to make the server do unbounded work.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be under ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
