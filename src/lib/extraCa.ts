import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

/**
 * Lets Node verify a few sites whose servers send their certificate chain
 * in an order Node's verifier cannot follow.
 *
 * The case this exists for is the Indian Institute of Astrophysics, which
 * publishes the only camera this map has in Ladakh. Its server sends two
 * chains for the same certificate. The first ends at an old Comodo root
 * that Node no longer ships, and Node stops there with
 * SELF_SIGNED_CERT_IN_CHAIN instead of trying the second, which ends at
 * the emSign root that Node does ship. Browsers and Windows try both and
 * are fine, which is why the site looks healthy everywhere but here.
 *
 * The files in assets/certs are the two intermediate certificates of that
 * second chain. They add no trust of their own: each was checked to be
 * signed by the one above it, up to "emSign Root CA - G1" in Node's own
 * store. Having them to hand simply lets the verifier find the good path
 * first. Certificate checking stays fully on, for this site and every
 * other; switching it off for a host was the alternative, and is exactly
 * the thing not to do in a process that fetches from hundreds of hosts.
 *
 * Needs Node 22.19 or later for setDefaultCACertificates. On an older
 * runtime this does nothing, and the affected cameras fail the way any
 * unreachable camera does.
 */
export function installExtraCaCertificates() {
  const api = tls as typeof tls & {
    getCACertificates?: (type?: string) => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (typeof api.setDefaultCACertificates !== "function" || typeof api.getCACertificates !== "function") return;

  try {
    const dir = path.join(process.cwd(), "assets", "certs");
    const extra: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".crt")) continue;
      const pem = fs.readFileSync(path.join(dir, file), "utf8");
      extra.push(...(pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []));
    }
    if (extra.length === 0) return;

    api.setDefaultCACertificates([...api.getCACertificates("default"), ...extra]);
    console.log(`[tls] ${extra.length} intermediate certificate(s) added to the default set`);
  } catch (error) {
    console.warn("[tls] could not add intermediate certificates:", error instanceof Error ? error.message : error);
  }
}
