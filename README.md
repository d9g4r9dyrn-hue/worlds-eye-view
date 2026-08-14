# World's Eye View

Thousands of public webcams quilted onto one satellite map. Zoom out and
you get the notable ones; zoom in and a city fills with live thumbnails.
Click any camera to watch it full size, or send several to a multicam
wall and watch them together.

Live at **[cams.corticorp.com](https://cams.corticorp.com)**.

Because every frame is real and refreshes on its own schedule, the map
drifts through the day with the world — you can see dawn crossing a
continent, or a city dark hours before its neighbour.

## Where the cameras come from

Around **25,000 cameras**, all from feeds that are public and need no key:

| Source | Roughly | Covers |
| --- | --- | --- |
| 511 traveler-information sites | 21,000 | 14 US states + 8 Canadian provinces/territories |
| Caltrans CCTV | 3,400 | California highways |
| Transport for London JamCams | 780 | Greater London |
| USGS Alaska Volcano Observatory | 64 | Alaska volcanoes and downwind communities |
| Windy Webcams *(optional)* | — | Worldwide, needs `WINDY_API_KEY` |

Without a Windy key the map still works; coverage is just North America
and London. Windy is what fills in the rest of the world and the
observatory/zoo/landmark cameras, which are almost all stream-only
elsewhere.

## Running it

```bash
npm install
npm run dev          # http://localhost:3002
```

The first request to `/api/cams` warms the catalogue by fetching every
source — about 40 seconds. Everything after that is served from memory,
and sources refresh independently in the background.

```bash
npm run build && npm start
npm run lint
npm run cams:verify  # walk every source, sample real frames, report rot
```

`cams:verify` is the one to run when a region looks emptier than it
should. Public webcams rot constantly and a dead camera is silent on the
map — it just doesn't draw.

## How it fits together

The whole app is a static page plus two route handlers. No database, no
scheduled jobs, no persistent storage.

- **`/api/cams`** — takes a bounding box and zoom, returns the cameras
  that should be drawn. It also does the thinning: projecting every
  candidate into screen pixels, dropping them into thumbnail-sized grid
  cells, and keeping the most interesting camera in each. That's what
  stops 4,800 Florida cameras from becoming a solid wall, and why a
  volcano beats a freeway for a slot at continental zoom.
- **`/api/cams/thumb`** — fetches a camera's current frame, downscales it
  with sharp (~6KB instead of ~120KB), and caches it in memory for as long
  as that camera's own refresh interval.

Two things worth preserving if you change any of it:

1. **Frames are proxied, never hotlinked.** The CSP allows `img-src
   'self'` plus one tile host. That's only possible because every frame
   comes back through our own origin, which in turn means adding a camera
   source never requires touching the security policy.
2. **The proxy resolves camera *ids*, not URLs.** It looks the id up in
   the catalogue and fetches the URL it finds there. Accepting a URL from
   the caller would make it an open image proxy.

See `AGENTS.md` for the file-by-file layout.

## Adding cameras

A surprising number of US states and Canadian provinces run the same 511
vendor platform, so adding one is a single entry in `STATES` in
`src/lib/cams/sources/onestop511.ts`. Confirm it actually answers
`/List/GetData/Cameras` with JSON first — plenty of 511 sites run
different software and return an HTML challenge page instead. Anything
else needs its own adapter in `src/lib/cams/sources/`.

Deployment: see `DEPLOY.md`.
