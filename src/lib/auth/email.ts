/**
 * Outbound email, via Resend.
 *
 * Degrades rather than fails. With no RESEND_API_KEY the message is
 * logged to the server console instead of being sent, which keeps the
 * whole sign-up flow testable end to end before the key exists — you can
 * register, copy the link out of the Railway log, and verify. When the
 * key is added nothing else changes.
 *
 * That fallback is deliberately noisy about what it is doing, because a
 * verification email that silently goes nowhere is the kind of thing
 * that gets discovered by a confused user rather than by us.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Where verification links point, and the From domain. */
export function siteOrigin(): string {
  return process.env.SITE_ORIGIN || "https://cams.corticorp.com";
}

function fromAddress(): string {
  // Overridable because the sender domain has to be one Resend has
  // verified, which may not be the site's own domain on day one.
  return process.env.AUTH_EMAIL_FROM || "World's Eye View <noreply@corticorp.com>";
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

interface Message {
  to: string;
  subject: string;
  text: string;
}

async function deliver(message: Message): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.warn(
      `[auth] RESEND_API_KEY is not set — email NOT sent.\n` +
        `       to: ${message.to}\n` +
        `       subject: ${message.subject}\n` +
        `${message.text}`
    );
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(),
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 300)}`);
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${siteOrigin()}/verify?token=${encodeURIComponent(token)}`;
  await deliver({
    to,
    subject: "Confirm your World's Eye View account",
    text:
      `Confirm your email address to finish setting up your account:\n\n${link}\n\n` +
      `The link is good for 24 hours.\n\n` +
      `If you didn't sign up, you can ignore this — the address won't be used for anything else.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${siteOrigin()}/reset?token=${encodeURIComponent(token)}`;
  await deliver({
    to,
    subject: "Reset your World's Eye View password",
    text:
      `Someone asked to reset the password for this account:\n\n${link}\n\n` +
      `The link is good for one hour and can be used once.\n\n` +
      `If that wasn't you, nothing has changed and you can ignore this.`,
  });
}
