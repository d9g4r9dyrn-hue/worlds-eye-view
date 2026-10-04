import type { MetadataRoute } from "next";

/** One real page. Every view of the map is the same page with a query string, and those canonicalise to it. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://cams.corticorp.com/", changeFrequency: "daily", priority: 1 }];
}
