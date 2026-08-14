/**
 * World's Eye View — a map quilted from public webcams.
 *
 * Everything on the map is one of these. Sources are wildly different
 * (a state DOT's JSON feed, a volcano observatory's HTML page, Windy's
 * API, a hand-curated list), so each adapter in ./sources normalizes
 * down to this one shape and the rest of the feature never knows or
 * cares where a given cam came from.
 */

export type CamCategory =
  | "traffic"
  | "volcano"
  | "observatory"
  | "airport"
  | "space"
  | "wildlife"
  | "city"
  | "harbor"
  | "mountain"
  | "weather";

export interface Cam {
  /** `<source>:<localId>` — stable, and the only cam handle the browser ever sees. */
  id: string;
  title: string;
  /** Nearest named place, when the source knows one. */
  place: string | null;
  country: string | null;
  lat: number;
  lon: number;
  category: CamCategory;
  /**
   * 1-10. Drives thumbnail size and, more importantly, who survives
   * thinning: at world zoom there's room for a few dozen thumbnails, so
   * the ISS and Kīlauea should win those slots over a freeway camera in
   * Fresno. See spatial.ts.
   */
  prominence: number;
  /**
   * Upstream still-image URL. Deliberately NOT sent to the browser — the
   * /api/cams/thumb proxy is what fetches this (see the route for why).
   */
  stillUrl: string;
  /**
   * Optional: resolve the image URL at fetch time instead of trusting the
   * one captured when the roster was built.
   *
   * Exists for sources that hand out short-lived, signed URLs — Windy's
   * free tier expires them after 10 minutes, far sooner than any sane
   * roster refresh. Rather than re-reading a whole catalogue every few
   * minutes to keep links alive, those sources leave the durable metadata
   * (coordinates, title, category) in the roster and mint a fresh URL only
   * for cameras somebody actually looks at.
   *
   * Server-side only, and never serialised — `toPublicCam` builds its
   * result field by field, so this can't leak to the browser.
   */
  resolveStillUrl?: (cam: Cam) => Promise<string>;
  /** Roughly how often the upstream image actually changes. Sets the thumbnail cache TTL. */
  refreshSeconds: number;
  /** Human-facing page for this cam — attribution, and "view the original". */
  sourcePage: string | null;
  /** Who publishes it. Always shown as a credit next to the image. */
  provider: string;
}

/** What the browser gets: `stillUrl` stripped, thumbnails addressed through our own proxy. */
export type PublicCam = Omit<Cam, "stillUrl">;

/**
 * Written out field by field rather than spread-and-delete on purpose:
 * adding a field to Cam then fails to compile here until someone decides
 * whether it belongs in the browser, which is the right place to make
 * that call for a type whose whole job is withholding the upstream URL.
 */
export function toPublicCam(cam: Cam): PublicCam {
  return {
    id: cam.id,
    title: cam.title,
    place: cam.place,
    country: cam.country,
    lat: cam.lat,
    lon: cam.lon,
    category: cam.category,
    prominence: cam.prominence,
    refreshSeconds: cam.refreshSeconds,
    sourcePage: cam.sourcePage,
    provider: cam.provider,
  };
}

/** A source adapter. Failure is always survivable — one dead feed must never empty the map. */
export interface CamSource {
  key: string;
  label: string;
  /** Rejecting/throwing is fine; the registry logs it and keeps the other sources. */
  fetchCams(): Promise<Cam[]>;
}
