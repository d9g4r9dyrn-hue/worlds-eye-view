# Deploying to cams.corticorp.com (Railway)

This needs a persistent Node process — GitHub Pages, where corticorp.com
itself lives, can't run it, because `/api/cams/thumb` has to fetch and
resize camera frames on every request. Railway hosts the app and
corticorp.com's DNS points a subdomain at it, exactly the arrangement
news.corticorp.com already uses.

**It does NOT need a volume, a database, or any API key.** That's the main
way this differs from the news deploy — the catalogue lives in memory and
rebuilds itself on boot, so there is nothing to persist and nothing to
back up. A restart costs about 40 seconds of warm-up on the first request.

## 1. Push the repo to GitHub

The repo is `worlds-eye-view` (this folder). Create an empty GitHub repo
and push, or use `gh repo create`:

```bash
gh repo create worlds-eye-view --private --source=. --push
```

## 2. Create the Railway service

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select `worlds-eye-view`.
2. Railway auto-detects Next.js and runs `npm install && npm run build`, then `npm start`. No configuration needed — `package.json` already has the right scripts, and `next start` picks up Railway's `PORT`.

Nothing else is required. There is deliberately no volume to mount and no
`DIGEST_DATA_DIR` equivalent.

## 3. Environment variables

Only one, and it's optional:

| Variable | Required | What it does |
| --- | --- | --- |
| `WINDY_API_KEY` | No | Adds Windy's global webcam catalogue. Without it the map covers North America and London only. Free key at [api.windy.com/webcams](https://api.windy.com/webcams). |

## 4. Point cams.corticorp.com at it

1. Railway service → **Settings → Networking → Custom Domain** → enter `cams.corticorp.com`. Railway shows a CNAME target like `xxxx.up.railway.app`.
2. GoDaddy → corticorp.com → **DNS Management** → add a record:
   - Type: `CNAME`
   - Name/Host: `cams`
   - Value: the target Railway gave you
   - TTL: default
3. Propagation is usually minutes.

## 5. Check it worked

```bash
curl -s "https://cams.corticorp.com/api/cams?south=24&west=-88&north=31&east=-80&zoom=8" \
  | head -c 400
```

Expect JSON with a `cams` array and a `total` in the mid-20,000s. The very
first call after a deploy takes ~40s while the catalogue warms; after that
it's instant.

Then open the site and confirm thumbnails actually draw — a JSON response
proves the catalogue loaded, not that frames are reachable from Railway's
network.

## Keeping it healthy

Public webcam feeds rot: a state retires a service, an agency moves its
buckets, a scraped page changes shape. None of that throws an error — the
affected cameras just stop drawing.

```bash
npm run cams:verify
```

Run that locally now and then, or after any report that a region looks
empty. It walks every source, samples real frames, and exits non-zero if a
feed has broken. Individual dead cameras are normal and expected; a source
where most of the sample fails is a broken adapter.

## Notes on scaling

- **Single replica is fine and preferred.** The catalogue and the frame
  cache are both per-process, so a second replica just doubles the
  upstream fetching for no benefit.
- **Memory** is bounded deliberately: the frame cache caps at 64MB and
  evicts least-recently-used, and the catalogue is ~25k small objects.
- **Outbound requests** are the real load, not CPU. A full catalogue
  refresh is a few hundred requests spread over its per-source TTLs
  (15 minutes for the volcano cams, 6 hours for everything else).
