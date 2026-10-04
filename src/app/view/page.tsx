import type { Metadata } from "next";
import { WorldsEyeViewClient } from "@/components/WorldsEyeViewClient";
import { peekCamById } from "@/lib/cams/registry";
import { placeLabel } from "@/lib/route/services";
import { OG_HEIGHT, OG_WIDTH, parseView, previewImagePath, viewQuery } from "@/lib/share/view";

/**
 * The map, opened at a particular view, with a link preview to match.
 *
 * Nobody navigates here by this path. `next.config.ts` rewrites
 * `/?lat=..&lon=..&zoom=..` to it, so the address a visitor sees and
 * shares stays the plain one while the bare home page stays a static
 * shell. The only thing this route adds over the home page is metadata
 * that depends on the query string, which is what forces it to render per
 * request and why it is kept apart.
 *
 * The map itself is the same client component and still reads its
 * opening view from `window.location`.
 */

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How long the page will wait on a place name before going without one. */
const LABEL_BUDGET_MS = 1_500;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const view = parseView(first);
  // A malformed link gets the site-wide defaults from the layout.
  if (!view) return {};

  const cam = view.cam ? peekCamById(view.cam) : null;

  let title: string;
  let description: string;

  if (cam) {
    const where = [cam.place, cam.country].filter(Boolean).join(", ");
    title = where ? `${cam.title}, ${where}: live camera` : `${cam.title}: live camera`;
    description = `A live look through the ${cam.provider} camera at ${cam.title}, on a satellite map of thousands of public webcams around the world.`;
  } else {
    const label = await Promise.race([
      placeLabel(view.lat, view.lon, view.zoom),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LABEL_BUDGET_MS)),
    ]);
    title = label ? `Live cameras around ${label}` : "Live cameras on the map";
    description = label
      ? `See ${label} right now through its public webcams, laid out on a satellite map with thousands more around the world.`
      : "Public webcams laid out on a satellite map, updating live. Zoom in and the world fills with windows.";
  }

  const url = `/?${viewQuery(view)}`;
  const image = { url: previewImagePath(view), width: OG_WIDTH, height: OG_HEIGHT, alt: title };

  return {
    title,
    description,
    // Search engines should fold every view into the home page. The
    // social crawlers read og:url instead, and that has to be this exact
    // link: Facebook re-fetches whatever og:url names and uses the
    // preview it finds there, so pointing it at the home page would give
    // every shared view the same generic picture.
    alternates: { canonical: "/" },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      siteName: "World's Eye View",
      title,
      description,
      url,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function ViewPage() {
  return (
    <div className="h-full w-full">
      <WorldsEyeViewClient />
    </div>
  );
}
