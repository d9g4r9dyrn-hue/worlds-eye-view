# Deploying to cams.corticorp.com (Railway)

This needs a persistent Node process — GitHub Pages, where corticorp.com
itself lives, can't run it, because `/api/cams/thumb` has to fetch and
resize camera frames on every request. Railway hosts the app and
corticorp.com's DNS points a subdomain at it, exactly the arrangement
news.corticorp.com already uses.

**It does NOT need a volume, and the camera map needs no database or API
key.** The catalogue lives in memory and rebuilds on boot, so there's
nothing to persist for it and nothing to back up; a restart costs about 40
seconds of warm-up, absorbed by a boot-time warm so no visitor pays it.

A Postgres service *is* attached, but only for optional accounts and saved
camera walls. If it went away entirely the map would carry on working —
that separation is deliberate and worth keeping.

## Current state

Already deployed and live. What exists right now:

| | |
| --- | --- |
| Railway project | `worlds-eye-view` (`6f7bd2b7-0f17-4809-afb6-a8e37d023f3e`) |
| Service | `web` (`d207d785-a776-41ea-9e86-a277002da3f6`) |
| Fallback URL | https://web-production-05942.up.railway.app |
| Custom domain | cams.corticorp.com |
| GitHub | https://github.com/d9g4r9dyrn-hue/worlds-eye-view (public) |

**Deploys are currently manual.** Railway's GitHub App is only authorised
for `corticorpmusic-oss/news`, so it cannot read this repo — creating the
project from the repo fails with "Failed to fetch repository files". The
service is therefore deployed from local source instead:

```bash
export RAILWAY_API_TOKEN=<account token>
npx @railway/cli up --detach --service web
```

That works fine, but **a `git push` does not redeploy anything.** To fix
that properly, grant the Railway GitHub App access to
`d9g4r9dyrn-hue/worlds-eye-view` (GitHub → Settings → Applications →
Railway → Repository access), then connect the repo in the service's
settings. After that, pushes to `master` deploy on their own.

## Setting it up from scratch

Only needed if the service is ever recreated.

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select `worlds-eye-view` (requires the GitHub App access above).
2. Railway auto-detects Next.js and runs `npm install && npm run build`, then `npm start`. No configuration needed — `package.json` already has the right scripts, and `next start` picks up Railway's `PORT`.

Nothing else is required. There is deliberately no volume to mount and no
`DIGEST_DATA_DIR` equivalent.

## 3. Environment variables

All optional. The map works fully with none of them set.

| Variable | Required | What it does |
| --- | --- | --- |
| `WINDY_API_KEY` | No | Adds Windy's global webcam catalogue. Without it, coverage is North America, Finland, London, New Zealand and Singapore. Free key at [api.windy.com/webcams](https://api.windy.com/webcams). |
| `DATABASE_URL` | No | Postgres for accounts and saved walls. Already set on Railway as `${{Postgres.DATABASE_URL}}`. |
| `AUTH_SECRET` | No | Signs session cookies. Already set. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | No | Google sign-in. **Not yet set** — see below. |

Accounts stay switched off until *all* of `DATABASE_URL`, `AUTH_SECRET`
and both Google values are present. Until then the sign-in button is
hidden and walls live in localStorage, which is a supported state rather
than a broken one.

### Turning on Google sign-in

Roughly ten minutes in the Google Cloud console, all free — no billing
account and no review process for this scope.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. `worlds-eye-view`).
2. **APIs & Services → OAuth consent screen**:
   - User type **External**, then **Publish app** (leaving it in Testing restricts sign-in to accounts you list by hand).
   - App name `World's Eye View`, your support email.
   - Authorised domain: `corticorp.com`.
   - Privacy policy URL: `https://cams.corticorp.com/privacy` (already live).
   - Scopes: leave the defaults. The app requests only `openid email profile`; adding anything else would trigger Google's verification review for no benefit.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**.
   - Authorised JavaScript origin: `https://cams.corticorp.com`
   - Authorised redirect URI: `https://cams.corticorp.com/api/auth/callback/google`

     That path is exact — a trailing slash or a missing `/google` produces `redirect_uri_mismatch` at sign-in.
4. Copy the client ID and secret onto the service:

```bash
railway variables --service web \
  --set AUTH_GOOGLE_ID=<client id> \
  --set AUTH_GOOGLE_SECRET=<client secret>
```

Railway redeploys automatically on a variable change. The sign-in button
appears once it's back up.

To add localhost sign-in for development, add `http://localhost:3002` as
an origin and `http://localhost:3002/api/auth/callback/google` as a
redirect URI on the same client.

## 4. Point cams.corticorp.com at it

1. Railway service → **Settings → Networking → Custom Domain** → enter `cams.corticorp.com`. Railway shows a CNAME target like `xxxx.up.railway.app`.
2. GoDaddy → corticorp.com → **DNS Management** → add a record:
   - Type: `CNAME`
   - Name/Host: `cams`
   - Value: the target Railway gave you
   - TTL: **lower it from the 1 hour default** if you expect to change it

3. **Add the ownership TXT record.** This is the step that will cost you an
   hour if you miss it, because nothing tells you it exists:

   | | |
   | --- | --- |
   | Type | `TXT` |
   | Name/Host | `_railway-verify.cams` |
   | Value | `railway-verify=<token>` |

   Get the token from the API — the Railway dashboard shows it, but the
   `customDomainCreate` mutation does **not** return it in `dnsRecords`:

   ```graphql
   query {
     domains(projectId: "...", environmentId: "...", serviceId: "...") {
       customDomains { status { verified verificationDnsHost verificationToken } }
     }
   }
   ```

### If the certificate sticks on VALIDATING_OWNERSHIP

**Check the TXT record first.** On first setup this exact thing burned an
hour and two unnecessary DNS edits.

The trap: `customDomainCreate` returns a `dnsRecords` array containing
*only* the CNAME, and once that CNAME resolves, Railway reports it as
`DNS_RECORD_STATUS_PROPAGATED`. It looks like everything is satisfied. It
isn't — the ownership TXT is required too, and it's exposed on separate
fields (`verified`, `verificationDnsHost`, `verificationToken`) that
aren't part of `dnsRecords`. `verified: false` is the tell, and
`VALIDATING_OWNERSHIP` means precisely what it says.

```bash
curl -s "https://dns.google/resolve?name=_railway-verify.cams.corticorp.com&type=TXT"
```

NXDOMAIN there is the answer. Add the record, call
`customDomainIssueCertificate(id:)`, and it goes `verified: true` →
`CERTIFICATE_STATUS_TYPE_VALID` within about a minute.

Only if the TXT is present and correct, check these:

```bash
# 1. Is the record right at the source? (bypasses every cache)
NS=$(curl -s "https://dns.google/resolve?name=corticorp.com&type=NS" | ...)
nslookup -type=CNAME cams.corticorp.com ns52.domaincontrol.com

# 2. Is a CAA record blocking issuance? Windows nslookup CANNOT query CAA
#    and fails silently with "unknown query type" — use DoH.
curl -s "https://dns.google/resolve?name=corticorp.com&type=CAA"

# 3. Is Railway's edge answering for the hostname at all?
curl -sI http://cams.corticorp.com   # expect 301 -> https
```

If all of those are fine, the remaining cause is **resolver caching**: the
GoDaddy record defaults to a 3600s TTL, so public resolvers keep serving
the old value for up to an hour even though the authoritative servers have
the new one. Wait it out. (Set new records to a 600s TTL to avoid this.)

`customDomainIssueCertificate(id:)` retriggers issuance and is worth one
attempt. **Do not delete and recreate the custom domain** — it issues a
*different* CNAME target, which means another DNS edit and another full
TTL wait. It was tried here on a wrong theory and achieved nothing except
rotating the target from `w7emtra1` to `5ki1mfj4`.

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
