import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * The "without nonces" CSP shape from Next's own docs
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * A nonce-based policy forces every page into dynamic rendering, and this
 * app's one page is a static shell whose content loads client-side.
 *
 * `img-src` is the interesting line. Camera frames are NOT listed here by
 * host, even though the catalogue spans dozens of third-party origins —
 * every frame is proxied through /api/cams/thumb and therefore arrives
 * from 'self'. The only external image origin is the Esri tile server
 * that draws the map underneath. That's deliberate: it means adding a new
 * camera source never requires touching this policy.
 */
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://server.arcgisonline.com;
  font-src 'self' data:;
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  // sharp is a native module — the thumbnail proxy calls it directly to
  // downscale frames. Marking it external makes Next require() it from
  // node_modules at runtime instead of trying to bundle the .node binding.
  serverExternalPackages: ["sharp"],

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader.replace(/\n/g, "") },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
