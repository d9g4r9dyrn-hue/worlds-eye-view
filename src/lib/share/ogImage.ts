import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { getCamById, getCatalog } from "@/lib/cams/registry";
import { isWithin, project, thinForViewport, thumbSize, unproject } from "@/lib/cams/spatial";
import { getFrame, isKnownUnavailable } from "@/lib/cams/thumbCache";
import { placeLabel } from "@/lib/route/services";
import type { Cam } from "@/lib/cams/types";
import { OG_HEIGHT, OG_WIDTH, type ShareView } from "./view";

/**
 * Draws the picture a shared link shows on LinkedIn, Facebook and the
 * rest.
 *
 * The picture is the map itself: satellite tiles for the shared view with
 * the live camera frames laid over them where the site would put them, so
 * a link to Tampa looks like Tampa and a link to Iceland looks like
 * Iceland. A link to a single camera leads with that camera's current
 * frame instead, over the same map.
 *
 * Everything is composed with sharp, which the thumbnail proxy already
 * depends on, and comes out as a JPEG of around 150KB. A PNG of satellite
 * imagery at this size runs past a megabyte, and the crawlers that fetch
 * these give up on slow images.
 *
 * Text is drawn from a font file shipped in the repository. The host has
 * no system fonts to speak of, and text set in a missing font renders as
 * empty boxes, so relying on whatever is installed is not an option.
 */

const TILE = 256;

/** Below this the whole world is narrower than the picture. */
const MIN_RENDER_ZOOM = 3;

/** Thumbnails are drawn a little larger than on the site, because the preview is shown small. */
const THUMB_SCALE = 1.25;
const THUMB_ASPECT = 0.72;
const MAX_THUMBS = 60;

/** Frames darker or flatter than this are not drawn in the preview. See drawMap. */
const MIN_PREVIEW_BRIGHTNESS = 14;
const MIN_PREVIEW_ENTROPY = 3;

/** How long to wait on camera frames and tiles before drawing with what has arrived. */
const FRAME_BUDGET_MS = 3_500;
const TILE_TIMEOUT_MS = 4_000;
const LABEL_BUDGET_MS = 2_500;

const FONT_FILE = path.join(process.cwd(), "assets", "fonts", "Geist-Regular.ttf");
const FONT_FAMILY = "Geist";

const ACCENT = "#38bdf8";

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

const globalForOg = globalThis as typeof globalThis & { __wevOgTiles?: Map<string, Buffer> };

/** Basemap tiles change on a scale of months, so a small cache saves most of the fetching. */
const tileCache: Map<string, Buffer> = (globalForOg.__wevOgTiles ??= new Map());
const MAX_TILES = 300;

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const key = `${z}/${y}/${x}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  try {
    const response = await fetch(`${ESRI_IMAGERY}/${key}`, {
      headers: { "User-Agent": "CorticorpWorldsEyeView/1.0 (+https://cams.corticorp.com)" },
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (tileCache.size >= MAX_TILES) tileCache.delete(tileCache.keys().next().value as string);
    tileCache.set(key, body);
    return body;
  } catch {
    // A missing tile leaves a dark square, which beats no picture.
    return null;
  }
}

/** Resolves to null once the deadline passes, without leaving a rejection unhandled. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

function escapeMarkup(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Piece {
  input: Buffer;
  width: number;
  height: number;
}

/**
 * One line of text as an image, or null if it could not be drawn.
 *
 * A failure here must not cost the whole picture, so every caller treats
 * a missing line as something to leave out.
 */
async function textLine(value: string, size: number, color: string, maxWidth: number): Promise<Piece | null> {
  // Cut first, so an absurdly long camera title is not rendered in full
  // only to be thrown away. The width check below catches what a
  // character count cannot.
  const roughLimit = Math.max(8, Math.floor(maxWidth / (size * 0.46)));
  const clipped = value.length > roughLimit ? `${value.slice(0, roughLimit - 1).trimEnd()}…` : value;

  try {
    const rendered = await sharp({
      text: {
        text: `<span foreground="${color}">${escapeMarkup(clipped)}</span>`,
        font: `${FONT_FAMILY} ${size}`,
        fontfile: FONT_FILE,
        rgba: true,
        dpi: 72,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });

    if (rendered.info.width <= maxWidth) {
      return { input: rendered.data, width: rendered.info.width, height: rendered.info.height };
    }

    const squeezed = await sharp(rendered.data).resize({ width: maxWidth }).png().toBuffer({ resolveWithObject: true });
    return { input: squeezed.data, width: squeezed.info.width, height: squeezed.info.height };
  } catch (error) {
    console.warn("[og] text failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The site's mark, as in Wordmark.tsx, with the accent colour written in. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 32 32">
  <path d="M2 16c4.4-6.4 9-9.6 14-9.6S25.6 9.6 30 16c-4.4 6.4-9 9.6-14 9.6S6.4 22.4 2 16Z" fill="#07131c" stroke="${ACCENT}" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="6.6" fill="#0b2739" stroke="${ACCENT}" stroke-width="1.3"/>
  <path d="M9.4 16h13.2M16 9.4c1.9 1.9 2.9 4.1 2.9 6.6s-1 4.7-2.9 6.6c-1.9-1.9-2.9-4.1-2.9-6.6s1-4.7 2.9-6.6Z" fill="none" stroke="${ACCENT}" stroke-width="1" opacity="0.85"/>
  <circle cx="16" cy="16" r="2.1" fill="${ACCENT}"/>
  <circle cx="14.4" cy="14.2" r="0.75" fill="#eaf7ff" opacity="0.9"/>
</svg>`;

interface MapLayer {
  /** Raw RGB pixels, OG_WIDTH by OG_HEIGHT. */
  pixels: Buffer;
  /** Cameras inside the picture, before thinning. */
  inView: number;
}

/** The satellite view with camera frames laid over it. */
async function drawMap(view: ShareView, withThumbs: boolean): Promise<MapLayer> {
  const zoom = Math.max(MIN_RENDER_ZOOM, view.zoom);
  const world = TILE * 2 ** zoom;
  const tilesAcross = 2 ** zoom;

  const centre = project(view.lat, view.lon, zoom);
  const left = Math.round(centre.x - OG_WIDTH / 2);
  const top = Math.round(centre.y - OG_HEIGHT / 2);

  // Everything is composed on a canvas aligned to the tile grid and the
  // picture is cut out of it afterwards. That keeps every offset
  // non-negative, and gives thumbnails near an edge somewhere to overhang.
  const firstCol = Math.floor(left / TILE);
  const lastCol = Math.floor((left + OG_WIDTH - 1) / TILE);
  const firstRow = Math.floor(top / TILE);
  const lastRow = Math.floor((top + OG_HEIGHT - 1) / TILE);
  const canvasWidth = (lastCol - firstCol + 1) * TILE;
  const canvasHeight = (lastRow - firstRow + 1) * TILE;
  const originX = firstCol * TILE;
  const originY = firstRow * TILE;

  const tileJobs: Promise<OverlayOptions | null>[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    // Past the poles there is no imagery; the dark base shows through.
    if (row < 0 || row >= tilesAcross) continue;
    for (let col = firstCol; col <= lastCol; col++) {
      // Columns wrap, so a view across the antimeridian is continuous.
      const wrapped = ((col % tilesAcross) + tilesAcross) % tilesAcross;
      tileJobs.push(
        fetchTile(zoom, wrapped, row).then((input) =>
          input ? { input, left: (col - firstCol) * TILE, top: (row - firstRow) * TILE } : null
        )
      );
    }
  }

  let inView = 0;
  const thumbJobs: Promise<{ overlay: OverlayOptions; width: number; height: number; rank: number } | null>[] = [];

  // A cold catalogue takes most of a minute to load. The crawler will not
  // wait for that, so the picture goes out without cameras rather than
  // not at all.
  const catalog = await within(getCatalog(), FRAME_BUDGET_MS);
  if (catalog) {
    const northWest = unproject(left, top, zoom);
    const southEast = unproject(left + OG_WIDTH, top + OG_HEIGHT, zoom);
    const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
    const box = {
      north: northWest.lat,
      south: southEast.lat,
      west: wrap(northWest.lon),
      east: wrap(southEast.lon),
    };

    const candidates = catalog.cams.filter((cam) => isWithin(box, cam.lat, cam.lon));
    inView = candidates.length;

    if (withThumbs) {
      const live = candidates.filter((cam) => !isKnownUnavailable(cam.id));
      const chosen = thinForViewport(live, { zoom, limit: MAX_THUMBS, spacing: 1.45 * THUMB_SCALE });
      const deadline = FRAME_BUDGET_MS;

      for (const cam of chosen) {
        const width = Math.round(thumbSize(zoom, cam.prominence) * THUMB_SCALE);
        const height = Math.round(width * THUMB_ASPECT);
        const point = project(cam.lat, cam.lon, zoom);
        const x = Math.round(((((point.x - originX) % world) + world) % world) - width / 2);
        const y = Math.round(point.y - originY - height / 2);
        // Anything that would hang off the canvas is outside the picture
        // or nearly so; leaving it out is simpler than clipping it.
        if (x < 0 || y < 0 || x + width > canvasWidth || y + height > canvasHeight) continue;

        thumbJobs.push(
          within(getFrame(cam, true), deadline).then(async (frame) => {
            if (!frame) return null;
            try {
              // On the map a black frame means it is night there, and that
              // is worth showing. In a picture meant to make someone click,
              // a black rectangle or a flat "camera unavailable" card is
              // only a hole, so both are left out here and nowhere else.
              const stats = await sharp(frame.body).stats();
              const mean = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / stats.channels.length;
              if (mean < MIN_PREVIEW_BRIGHTNESS || stats.entropy < MIN_PREVIEW_ENTROPY) return null;

              const input = await sharp(frame.body).resize(width, height, { fit: "cover" }).toBuffer();
              return { overlay: { input, left: x, top: y }, width, height, rank: cam.prominence };
            } catch {
              return null;
            }
          })
        );
      }
    }
  }

  const [tiles, thumbs] = await Promise.all([Promise.all(tileJobs), Promise.all(thumbJobs)]);

  // The most prominent camera is drawn last, so it sits on top where two
  // touch, the same order the site stacks them in.
  const drawn = thumbs.filter((thumb) => thumb !== null).sort((a, b) => a.rank - b.rank);

  const rect = (thumb: (typeof drawn)[number], extra: string) =>
    `<rect x="${thumb.overlay.left}" y="${thumb.overlay.top}" width="${thumb.width}" height="${thumb.height}" ${extra}/>`;

  const shadows = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <g transform="translate(0 3)" fill="rgba(0,0,0,0.5)" stroke="rgba(0,0,0,0.35)" stroke-width="5">${drawn
      .map((thumb) => rect(thumb, ""))
      .join("")}</g></svg>`;
  const rings = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
    <g fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5">${drawn.map((thumb) => rect(thumb, "")).join("")}</g></svg>`;

  const composed = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#06080b" },
  })
    .composite([
      ...tiles.filter((tile) => tile !== null),
      ...(drawn.length ? [{ input: Buffer.from(shadows), left: 0, top: 0 }] : []),
      ...drawn.map((thumb) => thumb.overlay),
      ...(drawn.length ? [{ input: Buffer.from(rings), left: 0, top: 0 }] : []),
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = await sharp(composed.data, {
    raw: { width: composed.info.width, height: composed.info.height, channels: composed.info.channels },
  })
    .extract({ left: left - originX, top: top - originY, width: OG_WIDTH, height: OG_HEIGHT })
    .removeAlpha()
    .raw()
    .toBuffer();

  return { pixels, inView };
}

/** The current frame of one camera, framed as a card. */
async function drawCamCard(cam: Cam): Promise<{ overlays: OverlayOptions[] } | null> {
  const frame = await within(getFrame(cam, false), FRAME_BUDGET_MS);
  if (!frame) return null;

  try {
    // Many traffic cameras publish 352x240. `inside` scales the frame up
    // to the card as well as down, since a postage stamp in the middle of
    // the picture would waste the one thing the link is about.
    const card = await sharp(frame.body, { failOn: "none" })
      .rotate()
      .resize(820, 430, { fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });

    const { width, height } = card.info;
    const left = Math.round((OG_WIDTH - width) / 2);
    const top = 34 + Math.round((430 - height) / 2);

    const frameSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <rect x="${left - 6}" y="${top - 2}" width="${width + 12}" height="${height + 14}" fill="rgba(0,0,0,0.45)"/>
      <rect x="${left - 3}" y="${top - 3}" width="${width + 6}" height="${height + 6}" fill="#e8f1f8"/>
    </svg>`;

    return {
      overlays: [
        { input: Buffer.from(frameSvg), left: 0, top: 0 },
        { input: card.data, left, top },
      ],
    };
  } catch {
    return null;
  }
}

/** Dark wash behind the caption, so white text reads over snow as well as over ocean. */
function captionWash(from: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#04070a" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#04070a" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#04070a" stop-opacity="0.94"/>
    </linearGradient></defs>
    <rect x="0" y="${from}" width="${OG_WIDTH}" height="${OG_HEIGHT - from}" fill="url(#g)"/>
  </svg>`);
}

const MARGIN = 48;

/** Renders the preview for a view. Always resolves to a JPEG; parts that fail are left out. */
export async function renderPreview(view: ShareView, isDefaultView: boolean): Promise<Buffer> {
  const cam = view.cam ? await within(getCamById(view.cam), FRAME_BUDGET_MS) : null;

  const [map, label, card] = await Promise.all([
    drawMap(view, true),
    cam || isDefaultView ? Promise.resolve(null) : within(placeLabel(view.lat, view.lon, view.zoom), LABEL_BUDGET_MS),
    cam ? drawCamCard(cam) : Promise.resolve(null),
  ]);

  let headline: string;
  let subline: string;

  if (cam && card) {
    headline = cam.title;
    subline = [[cam.place, cam.country].filter(Boolean).join(", "), cam.provider]
      .filter(Boolean)
      .join("  ·  ");
  } else {
    headline = label ?? "Live webcams, worldwide";
    subline =
      map.inView > 0
        ? `${map.inView.toLocaleString("en-US")} live ${map.inView === 1 ? "camera" : "cameras"} in this view`
        : "Thousands of public webcams on one satellite map";
  }

  const brandWidth = 300;
  const [headlineText, sublineText, brandText, hostText] = await Promise.all([
    textLine(headline, 54, "#ffffff", OG_WIDTH - MARGIN * 2 - brandWidth - 24),
    textLine(subline, 25, "#b9c9d9", OG_WIDTH - MARGIN * 2 - brandWidth - 24),
    textLine("World's Eye View", 29, "#ffffff", brandWidth),
    textLine("cams.corticorp.com", 21, ACCENT, brandWidth),
  ]);

  const overlays: OverlayOptions[] = [];

  let base = sharp(map.pixels, { raw: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3 } });
  if (cam && card) {
    // The map steps back so the camera frame is plainly the subject.
    const dimmed = await base.blur(2.5).modulate({ brightness: 0.55 }).raw().toBuffer();
    base = sharp(dimmed, { raw: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3 } });
    overlays.push({ input: captionWash(360), left: 0, top: 0 }, ...card.overlays);
  } else {
    overlays.push({ input: captionWash(330), left: 0, top: 0 });
  }

  const bottom = OG_HEIGHT - MARGIN;

  // Caption, bottom left: the subline sits on the margin and the headline above it.
  let cursor = bottom;
  if (sublineText) {
    cursor -= sublineText.height;
    overlays.push({ input: sublineText.input, left: MARGIN, top: cursor });
    cursor -= 14;
  }
  if (headlineText) {
    overlays.push({ input: headlineText.input, left: MARGIN, top: cursor - headlineText.height });
  }

  // Brand, bottom right, set against the right margin.
  const right = OG_WIDTH - MARGIN;
  let brandCursor = bottom;
  if (hostText) {
    brandCursor -= hostText.height;
    overlays.push({ input: hostText.input, left: right - hostText.width, top: brandCursor });
    brandCursor -= 12;
  }
  if (brandText) {
    const top = brandCursor - brandText.height;
    overlays.push({ input: brandText.input, left: right - brandText.width, top });
    overlays.push({ input: Buffer.from(LOGO_SVG), left: right - brandText.width - 64, top: top + Math.round(brandText.height / 2) - 26 });
  }

  return base.composite(overlays).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

/** The picture of last resort: brand on a dark field, for when the renderer itself throws. */
export async function renderFallback(): Promise<Buffer> {
  const [brandText, hostText] = await Promise.all([
    textLine("World's Eye View", 64, "#ffffff", 900),
    textLine("Live public webcams on one satellite map", 30, "#b9c9d9", 1000),
  ]);

  const overlays: OverlayOptions[] = [];
  if (brandText) overlays.push({ input: brandText.input, left: Math.round((OG_WIDTH - brandText.width) / 2), top: 250 });
  if (hostText) overlays.push({ input: hostText.input, left: Math.round((OG_WIDTH - hostText.width) / 2), top: 340 });

  return sharp({ create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, background: "#06080b" } })
    .composite(overlays)
    .jpeg({ quality: 84 })
    .toBuffer();
}
