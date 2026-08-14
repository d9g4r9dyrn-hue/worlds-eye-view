import { lookup } from "node:dns/promises";
import { isPrivateIp } from "./privateIp";

/**
 * Rejects fetching a URL whose hostname is a bare private/loopback/
 * link-local IP literal, or resolves via DNS to one — the classic SSRF
 * vector for code that fetches externally-supplied URLs (RSS enclosure
 * links, scraped og:image targets, third-party search results). Guards
 * against a malicious/compromised source pointing a fetch at an internal
 * address (e.g. a cloud metadata endpoint).
 *
 * Best-effort: there's a small window between this lookup and the actual
 * fetch()'s own DNS resolution where the record could change (DNS
 * rebinding), but a pre-fetch check closes the common case — a hostname
 * that's privately-routed *right now* — which is what every URL in this
 * codebase's fetch call sites actually needs. A resolution failure isn't
 * this function's problem to solve — it returns true so the real fetch()
 * fails with its own natural network error instead of masking it.
 */
export async function isUrlSafeToFetch(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost" || isPrivateIp(hostname)) return false;

  try {
    const { address } = await lookup(hostname);
    return !isPrivateIp(address);
  } catch {
    return true;
  }
}
