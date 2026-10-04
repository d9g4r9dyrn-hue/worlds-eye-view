import type { MetadataRoute } from "next";

/**
 * Crawlers are welcome on the pages and kept off the API.
 *
 * The API is the map's own plumbing: a crawler walking it would pull
 * camera frames through the proxy for nobody. The one exception is the
 * preview picture, which the social crawlers must be able to fetch or a
 * shared link shows no image.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/api/og"], disallow: ["/api/"] }],
    sitemap: "https://cams.corticorp.com/sitemap.xml",
  };
}
