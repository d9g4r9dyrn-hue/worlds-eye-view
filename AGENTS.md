# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# World's Eye View

Public webcams from around the world drawn onto one satellite map. No
database, no API keys required, no scheduled jobs — the whole app is a
static shell plus two route handlers.

## Shape of it

- **`src/lib/cams/sources/*`** — one adapter per upstream feed. Each one
  normalises to the `Cam` shape in `types.ts` and is allowed to fail; the
  registry logs it and keeps the others.
- **`src/lib/cams/registry.ts`** — merges the sources into one in-memory
  catalogue, refreshed per-source on its own TTL (stale-while-revalidate).
  There is no persistence: a cold start re-fetches, which takes ~30s.
- **`src/lib/cams/spatial.ts`** — Web Mercator projection plus the grid
  thinning that decides which cameras get a slot on screen.
- **`src/lib/cams/thumbCache.ts`** — fetches, downscales (sharp) and
  caches frames in memory, and rejects "camera unavailable" placeholder
  images.
- **`src/app/api/cams`** — viewport query. **`/api/cams/thumb`** — frame proxy.

## Two invariants worth not breaking

1. **Camera frames must keep coming from our own origin.** The CSP allows
   `img-src 'self'` plus the Esri tile host and nothing else. That's only
   possible because `/api/cams/thumb` proxies every frame. Pointing an
   `<img>` at an upstream camera URL would mean allowlisting dozens of
   third-party hosts.
2. **The thumb proxy resolves camera ids, never URLs.** It looks the id up
   in the catalogue and uses the URL it finds there. Accepting a URL
   parameter would turn it into an open image proxy.

## Commands

- `npm run dev` — dev server on **port 3002** (3000 and 3001 are taken by
  sibling projects)
- `npm run build` / `npm start`
- `npm run lint`
- `npm run cams:verify` — walks every source, samples real frames, and
  exits non-zero if a feed has rotted. Run it when a region looks emptier
  than it should.

## Adding a camera source

Most US states and Canadian provinces run the same 511 vendor platform, so
adding one is a single entry in `STATES` in `sources/onestop511.ts` — but
confirm it actually answers `/List/GetData/Cameras` first, since a fair
number run different software. Anything else needs its own adapter.
