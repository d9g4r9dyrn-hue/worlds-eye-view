import type { Cam, CamCategory, CamSource } from "../types";
import { solarPosition } from "../../sun";

/**
 * The hand-curated layer.
 *
 * This comes in two halves, and the second one is doing most of the work.
 *
 * STANDALONE_CAMS is for cameras that exist outside any feed — you know
 * the image URL, so you write it down. It's deliberately short. The
 * marquee cameras people picture when they hear "public webcam"
 * (observatories, launch pads, zoos, Times Square) have almost all moved
 * to YouTube/HLS streams or sit behind hotlink protection and login
 * walls, so there's no still image to hang on a map pin. Every candidate
 * in this file was fetched before being listed; anything that 403'd,
 * redirected to a login page or returned HTML was left out rather than
 * shipped broken. Windy is the real answer for that category — it has
 * those cameras and it hands over a thumbnail — which is why setting
 * WINDY_API_KEY changes the character of the map so much.
 *
 * PROMOTIONS is the half that earns its keep. The feeds already contain
 * genuinely notable cameras — the Bay Bridge tower, Piccadilly Circus,
 * Tower Bridge — but they arrive labelled like the traffic infrastructure
 * they technically are ("TVD32 -- I-80 : Bay Bridge SAS Tower East") and
 * ranked accordingly, so they lose their thumbnail slot to nothing in
 * particular. Promoting one rewrites its title and raises its prominence
 * so it holds a slot at city zoom and reads like the landmark it is.
 */

/**
 * Helpers for the few operators that publish the current frame under a
 * name that changes with every upload. Each one asks the operator's own
 * page or endpoint for the newest frame at fetch time, through the
 * `resolveStillUrl` hook, so the roster never holds a dated URL that has
 * already rotated away. They throw on anything unexpected, which the frame
 * proxy treats the same as an upstream failure.
 */
const RESOLVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchResolverText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": RESOLVER_UA },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`resolver ${url} responded ${response.status}`);
  return response.text();
}

/**
 * Australian Antarctic Division: frames are filed by date and minute
 * (webcams/casey/2026/10/04/C2610041427s.jpg), and the station page is the
 * only place that names the newest one.
 */
function aadStill(stationPage: string): (cam: Cam) => Promise<string> {
  return async () => {
    const html = await fetchResolverText(stationPage);
    const match = html.match(/https:\/\/images\.antarctica\.gov\.au\/webcams\/[a-z]+\/[0-9/]+\/[A-Za-z0-9]+\.jpg/);
    if (!match) throw new Error(`no webcam frame found on ${stationPage}`);
    return match[0];
  };
}

/**
 * US Antarctic Program: the public webcam pages poll this component, which
 * answers "McM00084.jpg?=4783740.2,Live,Live". The file name cycles through
 * a numbered ring, so it has to be asked for each time.
 */
function usapStill(location: string, camera: string): (cam: Cam) => Promise<string> {
  return async () => {
    const endpoint =
      "https://www.usap.gov/components/webcams.cfc?method=outputCurrentCamImage" +
      `&cameraLocation=${encodeURIComponent(location)}&camera=${encodeURIComponent(camera)}`;
    const file = (await fetchResolverText(endpoint)).trim().split(",")[0].split("?")[0];
    if (!/^[A-Za-z0-9_-]+\.jpg$/.test(file)) throw new Error(`unexpected USAP webcam answer for ${camera}`);
    return `https://www.usap.gov/videoclipsandmaps/SouthPoleWebcam/${file}`;
  };
}

/**
 * Neumayer III keeps one file per ten-minute slot of the UTC day and
 * overwrites it 24 hours later, so the newest frame is found from the
 * clock alone. Four minutes of slack because the upload lands a little
 * after the slot starts; asking too early would return yesterday's frame.
 */
async function neumayerStill(): Promise<string> {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() - 4;
  const slot = Math.floor(((minutes + 1440) % 1440) / 10);
  const hh = String(Math.floor(slot / 6)).padStart(2, "0");
  const mm = String((slot % 6) * 10).padStart(2, "0");
  return `https://www.awi.de/NM_WebCam/neumayerW.${hh}${mm}.jpg`;
}

/**
 * Korea Polar Data Center: each frame has a numeric id, and this endpoint
 * lists the recent ones newest first.
 */
function kopriStill(station: string): (cam: Cam) => Promise<string> {
  return async () => {
    const endpoint = `https://kpdc.kopri.re.kr/live-data/cctv/${station}/recent`;
    const frames: unknown = JSON.parse(await fetchResolverText(endpoint));
    const id = Array.isArray(frames) ? (frames[0] as { id?: unknown } | undefined)?.id : undefined;
    if (typeof id !== "number") throw new Error(`no recent KOPRI frame for ${station}`);
    return `https://kpdc.kopri.re.kr/live-data/cctv/${id}`;
  };
}

/** PhenoCam serves every site's newest upload at one fixed address. */
function phenocam(site: string): { stillUrl: string; sourcePage: string } {
  return {
    stillUrl: `https://phenocam.nau.edu/data/latest/${site}.jpg`,
    sourcePage: `https://phenocam.nau.edu/webcam/sites/${site}/`,
  };
}

/**
 * Cameras with no feed behind them. See the note above on why this list is short.
 *
 * Everything below was added on 2026-10-04 to put pins in regions where no
 * feed and no Windy camera exists: Antarctica, central Africa, the high
 * Arctic, the South Atlantic and Patagonia. Each one was fetched that day
 * exactly as the frame proxy fetches it (browser User-Agent, no Referer),
 * decoded with sharp, looked at, and confirmed current from its
 * Last-Modified header or the timestamp burned into the picture.
 * Coordinates are the operator's published station coordinates.
 *
 * Polar cameras are legitimately dark for months: the Antarctic ones in
 * the southern winter, Svalbard and Barrow in the northern one. A black
 * frame there is the polar night, not a fault.
 */
/**
 * Indian Astronomical Observatory, Hanle. The site publishes a daytime
 * camera and an all-sky camera, and rewrites both files every minute
 * whether or not they have changed: at local midnight the "day" picture
 * is still that afternoon's, under a Last-Modified a minute old. Showing
 * a sunlit dome at midnight would be the one thing this map must not do,
 * so the picture follows the sun: the dome camera while the sun is up,
 * the all-sky camera once it is down.
 */
async function hanleStill(cam: Cam): Promise<string> {
  const up = solarPosition(cam.lat, cam.lon, new Date()).altitudeDeg > -2;
  return `https://www.iiap.res.in/media/images/${up ? "day" : "allsky"}.original.jpg`;
}

const STANDALONE_CAMS: Cam[] = [
  // Indian Institute of Astrophysics. Checked 2026-10-04: frame stamped
  // 13:35 IST the same day. The only first-party camera found anywhere in
  // India, at 4,500 m in Ladakh. Its server's certificate chain needs the
  // intermediates in assets/certs; see src/lib/extraCa.ts.
  {
    id: "curated:iia-hanle",
    title: "Indian Astronomical Observatory, Hanle",
    place: "Hanle, Ladakh",
    country: "India",
    lat: 32.7794,
    lon: 78.9642,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://www.iiap.res.in/media/images/day.original.jpg",
    resolveStillUrl: hanleStill,
    refreshSeconds: 600,
    sourcePage: "https://www.iiap.res.in/centers/iao/mets/",
    provider: "Indian Institute of Astrophysics",
  },

  // --- Antarctica ---

  // Australian Antarctic Division. Checked 2026-10-04: four station pages each
  // named a frame under 10 minutes old. Updates every 10 minutes.
  {
    id: "curated:aad-casey",
    title: "Casey research station",
    place: "Casey Station",
    country: "Antarctica",
    lat: -66.2823,
    lon: 110.5268,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.antarctica.gov.au/antarctic-operations/webcams/casey/",
    resolveStillUrl: aadStill("https://www.antarctica.gov.au/antarctic-operations/webcams/casey/"),
    refreshSeconds: 600,
    sourcePage: "https://www.antarctica.gov.au/antarctic-operations/webcams/casey/",
    provider: "Australian Antarctic Division",
  },
  {
    id: "curated:aad-davis",
    title: "Davis research station",
    place: "Davis Station",
    country: "Antarctica",
    lat: -68.5766,
    lon: 77.9674,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.antarctica.gov.au/antarctic-operations/webcams/davis/",
    resolveStillUrl: aadStill("https://www.antarctica.gov.au/antarctic-operations/webcams/davis/"),
    refreshSeconds: 600,
    sourcePage: "https://www.antarctica.gov.au/antarctic-operations/webcams/davis/",
    provider: "Australian Antarctic Division",
  },
  {
    id: "curated:aad-mawson",
    title: "Mawson research station",
    place: "Mawson Station",
    country: "Antarctica",
    lat: -67.6027,
    lon: 62.8738,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.antarctica.gov.au/antarctic-operations/webcams/mawson/",
    resolveStillUrl: aadStill("https://www.antarctica.gov.au/antarctic-operations/webcams/mawson/"),
    refreshSeconds: 600,
    sourcePage: "https://www.antarctica.gov.au/antarctic-operations/webcams/mawson/",
    provider: "Australian Antarctic Division",
  },
  // Sub-Antarctic, halfway between Tasmania and the continent; Australian territory.
  {
    id: "curated:aad-macquarie-island",
    title: "Macquarie Island research station",
    place: "Macquarie Island",
    country: "Australia",
    lat: -54.4997,
    lon: 158.9369,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.antarctica.gov.au/antarctic-operations/webcams/macquarie-island/",
    resolveStillUrl: aadStill("https://www.antarctica.gov.au/antarctic-operations/webcams/macquarie-island/"),
    refreshSeconds: 600,
    sourcePage: "https://www.antarctica.gov.au/antarctic-operations/webcams/macquarie-island/",
    provider: "Australian Antarctic Division",
  },

  // US Antarctic Program. Checked 2026-10-04: McMurdo and Palmer frames were
  // under a minute old. The stillUrl is the endpoint the resolver asks, not an image.
  {
    id: "curated:usap-mcmurdo",
    title: "McMurdo Station from Arrival Heights",
    place: "McMurdo Station",
    country: "Antarctica",
    lat: -77.8463,
    lon: 166.6683,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.usap.gov/components/webcams.cfc?method=outputCurrentCamImage&cameraLocation=McMurdo&camera=arrivalHeights",
    resolveStillUrl: usapStill("McMurdo", "arrivalHeights"),
    refreshSeconds: 120,
    sourcePage: "https://www.usap.gov/videoclipsandmaps/mcmwebcam.cfm",
    provider: "US Antarctic Program / NSF",
  },
  {
    id: "curated:usap-palmer",
    title: "Palmer Station",
    place: "Palmer Station, Anvers Island",
    country: "Antarctica",
    lat: -64.7743,
    lon: -64.0538,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.usap.gov/components/webcams.cfc?method=outputCurrentCamImage&cameraLocation=Palmer&camera=palmer",
    resolveStillUrl: usapStill("Palmer", "palmer"),
    refreshSeconds: 120,
    sourcePage: "https://www.usap.gov/videoclipsandmaps/palwebcam.cfm",
    provider: "US Antarctic Program / NSF",
  },

  // NOAA's camera on the Atmospheric Research Observatory at the South Pole.
  // Checked 2026-10-04: frame stamped 13:20 UTC, 75 minutes old, which is
  // normal: the station only has a satellite link for part of each day, so
  // the picture arrives in bursts. The true latitude is 90 S. Web Mercator
  // cannot draw the pole and the viewport query stops at 85.05 S, so the pin
  // sits at 85 S, the southern edge of the map, or it would never be shown.
  {
    id: "curated:noaa-south-pole",
    title: "South Pole, Amundsen-Scott Station",
    place: "South Pole",
    country: "Antarctica",
    lat: -85,
    lon: 0,
    category: "weather",
    prominence: 8,
    stillUrl: "https://gml.noaa.gov/webdata/spo/webcam/cmdlfullsize.jpg",
    refreshSeconds: 900,
    sourcePage: "https://gml.noaa.gov/obop/spo/livecamera.html",
    provider: "NOAA Global Monitoring Laboratory",
  },

  // Alfred Wegener Institute. Checked 2026-10-04: the 14:20 and 14:30 UTC slots
  // held today's frames. Black and white at night.
  {
    id: "curated:awi-neumayer",
    title: "Neumayer Station III",
    place: "Ekström Ice Shelf",
    country: "Antarctica",
    lat: -70.6744,
    lon: -8.2742,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.awi.de/NM_WebCam/neumayerW.1200.jpg",
    resolveStillUrl: neumayerStill,
    refreshSeconds: 600,
    sourcePage: "https://www.awi.de/en/expedition/stations/neumayer-station-iii.html",
    provider: "Alfred Wegener Institute",
  },

  // British Antarctic Survey. The latest.php endpoint answers with a redirect
  // to the newest dated frame, which fetch follows, so no resolver is needed.
  // Checked 2026-10-05: Halley's frame was stamped 02:30 UTC the same night;
  // frames arrive every 30 to 60 minutes. Rothera's endpoint redirected to a
  // file that did not exist and Signy and King Edward Point returned nothing,
  // so those three are left out.
  {
    id: "curated:bas-halley",
    title: "Halley VI Research Station",
    place: "Brunt Ice Shelf",
    country: "Antarctica",
    lat: -75.5675,
    lon: -25.5167,
    category: "weather",
    prominence: 8,
    stillUrl: "https://legacy.bas.ac.uk/images/webcams/latest/latest.php?cam=halley",
    refreshSeconds: 1800,
    sourcePage: "https://www.bas.ac.uk/data/our-data/images/webcams/halley-vi-webcam/",
    provider: "British Antarctic Survey",
  },

  // Antarctica New Zealand. Checked 2026-10-04: Last-Modified moved 14:29, 14:49, 14:59 UTC.
  {
    id: "curated:antnz-scott-base",
    title: "Scott Base",
    place: "Ross Island",
    country: "Antarctica",
    lat: -77.8492,
    lon: 166.7682,
    category: "weather",
    prominence: 8,
    stillUrl: "https://view.antarcticanz.govt.nz/webcams2/sbview.jpg",
    refreshSeconds: 600,
    sourcePage: "https://www.antarcticanz.govt.nz/scott-base/webcams-weather",
    provider: "Antarctica New Zealand",
  },

  // National Institute of Polar Research, Japan. Checked 2026-10-04: frame under a minute old.
  {
    id: "curated:nipr-syowa",
    title: "Syowa Station",
    place: "East Ongul Island",
    country: "Antarctica",
    lat: -69.0041,
    lon: 39.5822,
    category: "weather",
    prominence: 8,
    stillUrl: "https://www.nipr.ac.jp/syowa-cam1.jpg",
    refreshSeconds: 600,
    sourcePage: "https://www.nipr.ac.jp/webcam/",
    provider: "National Institute of Polar Research, Japan",
  },

  // Korea Polar Research Institute. Checked 2026-10-04: newest frames were
  // stamped 14:54 and 14:51 UTC. The stillUrl is the listing the resolver reads.
  {
    id: "curated:kopri-king-sejong",
    title: "King Sejong Station",
    place: "King George Island",
    country: "Antarctica",
    lat: -62.2233,
    lon: -58.7867,
    category: "weather",
    prominence: 8,
    stillUrl: "https://kpdc.kopri.re.kr/live-data/cctv/ksj/recent",
    resolveStillUrl: kopriStill("ksj"),
    refreshSeconds: 600,
    sourcePage: "https://kpdc.kopri.re.kr/live-data/weather",
    provider: "Korea Polar Research Institute",
  },
  {
    id: "curated:kopri-jang-bogo",
    title: "Jang Bogo Station",
    place: "Terra Nova Bay",
    country: "Antarctica",
    lat: -74.6240,
    lon: 164.2283,
    category: "weather",
    prominence: 8,
    stillUrl: "https://kpdc.kopri.re.kr/live-data/cctv/jbg/recent",
    resolveStillUrl: kopriStill("jbg"),
    refreshSeconds: 600,
    sourcePage: "https://kpdc.kopri.re.kr/live-data/weather",
    provider: "Korea Polar Research Institute",
  },

  // --- Africa and the Indian Ocean ---

  // PhenoCam research cameras: fixed canopy and landscape views kept by the
  // site's own scientists and published through Northern Arizona University.
  // Checked 2026-10-04: each frame carried that day's local timestamp. They
  // photograph in daylight only, so the last frame of the day stands overnight.
  {
    id: "curated:phenocam-congoflux",
    title: "Congo Basin rainforest canopy, CongoFlux tower",
    place: "Yangambi",
    country: "DR Congo",
    lat: 0.8144,
    lon: 24.5024,
    category: "weather",
    prominence: 7,
    ...phenocam("congoflux"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / CongoFlux",
  },
  {
    id: "curated:phenocam-ileret",
    title: "Turkana Basin Institute, Ileret",
    place: "Ileret, Lake Turkana",
    country: "Kenya",
    lat: 4.2888,
    lon: 36.2611,
    category: "weather",
    prominence: 7,
    ...phenocam("ileret"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Turkana Basin Institute",
  },
  {
    id: "curated:phenocam-beza-mahafaly",
    title: "Beza Mahafaly Special Reserve",
    place: "Beza Mahafaly",
    country: "Madagascar",
    lat: -23.6558,
    lon: 44.6289,
    category: "weather",
    prominence: 7,
    ...phenocam("bezamahafaly"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Beza Mahafaly Special Reserve",
  },

  // South African Astronomical Observatory, Sutherland. Checked 2026-10-05:
  // all-sky frame stamped 05:31 SAST, two minutes old; rewritten every minute.
  // Its server sends only its own certificate, so the Sectigo intermediate in
  // assets/certs is what lets Node verify it; see src/lib/extraCa.ts.
  {
    id: "curated:saao-sutherland-allsky",
    title: "All-sky camera, SAAO Sutherland",
    place: "Sutherland, Northern Cape",
    country: "South Africa",
    lat: -32.3783,
    lon: 20.8105,
    category: "observatory",
    prominence: 7,
    stillUrl: "https://suthweather.saao.ac.za/AllSkyCurrentImageMarked.JPG",
    refreshSeconds: 120,
    sourcePage: "https://suthweather.saao.ac.za/",
    provider: "South African Astronomical Observatory",
  },

  // AEMET's Izaña Atmospheric Research Center, 2,370 m up on Tenerife, off the
  // Sahara coast. Checked 2026-10-05: frame stamped 03:30 local, six minutes
  // old; new frames every five to ten minutes.
  {
    id: "curated:aemet-izana-north",
    title: "Izaña Atmospheric Observatory, looking north",
    place: "Izaña, Tenerife",
    country: "Spain",
    lat: 28.309,
    lon: -16.4993,
    category: "observatory",
    prominence: 7,
    stillUrl: "https://izana.aemet.es/wp-content/rtime/camaras/north.jpg",
    refreshSeconds: 600,
    sourcePage: "https://izana.aemet.es/webcams-real/",
    provider: "AEMET Izaña Atmospheric Research Center",
  },

  // Crown and Champa Resorts' own cameras on two of its Maldivian islands,
  // served from the group's own host and embedded on each resort's site.
  // Checked 2026-10-05: frames stamped 09:45 and 09:48 resort time, minutes
  // old. Resort time runs an hour ahead of Malé.
  {
    id: "curated:kuredu-pool",
    title: "Kuredu Island, pool and lagoon",
    place: "Kuredu, Lhaviyani Atoll",
    country: "Maldives",
    lat: 5.5497,
    lon: 73.461,
    category: "weather",
    prominence: 7,
    stillUrl: "https://www.maldiveswebcams.com/kuredu/kuredu-pool/poolcam/live.jpg",
    refreshSeconds: 120,
    sourcePage: "https://www.kuredu.com/webcams/",
    provider: "Kuredu Island Resort",
  },
  {
    id: "curated:komandoo-pool",
    title: "Komandoo Island, infinity pool",
    place: "Komandoo, Lhaviyani Atoll",
    country: "Maldives",
    lat: 5.4967,
    lon: 73.4194,
    category: "weather",
    prominence: 6,
    stillUrl: "https://www.maldiveswebcams.com/komandoo/komandoo-pool/live.jpg",
    refreshSeconds: 120,
    sourcePage: "https://www.komandoo.com/webcam/",
    provider: "Komandoo Island Resort",
  },

  // Observatoire Volcanologique du Piton de la Fournaise. Checked 2026-10-04:
  // frame stamped 14:35 UTC. The observatory publishes a map, not coordinates,
  // for each camera, so the pin is on the volcano's summit, which is the subject.
  {
    id: "curated:ovpf-piton-de-bert",
    title: "Piton de la Fournaise from Piton de Bert",
    place: "Piton de la Fournaise",
    country: "Réunion",
    lat: -21.2442,
    lon: 55.7089,
    category: "volcano",
    prominence: 8,
    stillUrl: "https://www.ipgp.fr/volcanoweb/reunion/Cameras/CameraBERT3.jpg",
    refreshSeconds: 300,
    sourcePage: "https://www.ipgp.fr/volcanoweb/reunion/html_static_webcam/cameras-ovpf.html",
    provider: "OVPF / Institut de physique du globe de Paris",
  },

  // --- Arctic ---

  // Kjell Henriksen Observatory, University Centre in Svalbard. Checked
  // 2026-10-04: frames stamped 14:40 and 14:55 UTC. Dark from late October to mid February.
  {
    id: "curated:kho-adventdalen",
    title: "Adventdalen from the Kjell Henriksen Observatory",
    place: "Longyearbyen, Svalbard",
    country: "Norway",
    lat: 78.148,
    lon: 16.043,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://kho.unis.no/SD/pics/cam3a.jpg",
    refreshSeconds: 900,
    sourcePage: "https://kho.unis.no/WebCameras.html",
    provider: "Kjell Henriksen Observatory / UNIS",
  },
  // Norwegian Polar Institute, Zeppelin Observatory. Checked 2026-10-04:
  // Last-Modified moved 14:40 then 14:50 UTC.
  {
    id: "curated:npolar-zeppelin",
    title: "Ny-Ålesund from the Zeppelin Observatory",
    place: "Ny-Ålesund, Svalbard",
    country: "Norway",
    lat: 78.9067,
    lon: 11.8883,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://data.npolar.no/_file/zeppelin/camera/Latest/zeppCam2.jpg",
    refreshSeconds: 600,
    // The UK Arctic Office page embeds this same frame; the institute's own pages sit behind a bot challenge.
    sourcePage: "https://www.arctic.ac.uk/uk-arctic-research-station/ny-alesund-webcam/",
    provider: "Norwegian Polar Institute",
  },
  // NOAA Barrow Atmospheric Baseline Observatory. Checked 2026-10-04:
  // Last-Modified moved 14:23 then 14:53 UTC.
  {
    id: "curated:noaa-barrow",
    title: "Barrow Observatory, view toward town",
    place: "Utqiaġvik, Alaska",
    country: "United States",
    lat: 71.323,
    lon: -156.6114,
    category: "observatory",
    prominence: 7,
    stillUrl: "https://gml.noaa.gov/webdata/brw/webcam/town.jpg",
    refreshSeconds: 1800,
    sourcePage: "https://gml.noaa.gov/obop/brw/livecamera.html",
    provider: "NOAA Global Monitoring Laboratory",
  },

  // Special Astrophysical Observatory, Russian Academy of Sciences, north
  // Caucasus. Checked 2026-10-04: all-sky frame stamped 17:53 Moscow time, current.
  {
    id: "curated:sao-ras-allsky",
    title: "All-sky camera, Special Astrophysical Observatory",
    place: "Nizhny Arkhyz, Karachay-Cherkessia",
    country: "Russia",
    lat: 43.6468,
    lon: 41.4405,
    category: "observatory",
    prominence: 6,
    stillUrl: "https://www.sao.ru/zserv/webcam/omea_allsky.cgi?midi",
    refreshSeconds: 300,
    sourcePage: "https://www.sao.ru/tb/webcam/mono_allsky.html",
    provider: "Special Astrophysical Observatory RAS",
  },

  // --- Pacific ---

  // GeoNet's camera on Raoul Island in the Kermadecs, 1,000 km north-east of
  // New Zealand. Checked 2026-10-04: frame stamped 03:40 NZDT, two minutes old.
  {
    id: "curated:geonet-raoul-island",
    title: "Raoul Island volcano",
    place: "Raoul Island, Kermadec Islands",
    country: "New Zealand",
    lat: -29.267,
    lon: -177.917,
    category: "volcano",
    prominence: 8,
    stillUrl: "https://images.geonet.org.nz/volcano/cameras/latest/raoulisland.jpg",
    refreshSeconds: 900,
    sourcePage: "https://www.geonet.org.nz/volcano/cameras",
    provider: "GeoNet / GNS Science",
  },
  // NOAA Mauna Loa Observatory, looking at Mauna Kea. Checked 2026-10-04:
  // Last-Modified moved 14:32 then 14:52 UTC.
  {
    id: "curated:noaa-mauna-loa",
    title: "Mauna Kea from the Mauna Loa Observatory",
    place: "Mauna Loa, Hawaii",
    country: "United States",
    lat: 19.5362,
    lon: -155.5763,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://gml.noaa.gov/webdata/mlo/webcam/mkcam.jpg",
    refreshSeconds: 1200,
    sourcePage: "https://gml.noaa.gov/obop/mlo/livecam/livecam.html",
    provider: "NOAA Global Monitoring Laboratory",
  },
  // USGS Hawaiian Volcano Observatory. Checked 2026-10-04: frame stamped
  // 04:39 HST with the vent glowing.
  {
    id: "curated:hvo-kilauea-v1",
    title: "Kīlauea summit, Halemaʻumaʻu vents",
    place: "Kīlauea, Hawaii",
    country: "United States",
    lat: 19.4069,
    lon: -155.2834,
    category: "volcano",
    prominence: 8,
    stillUrl: "https://volcanoes.usgs.gov/observatories/hvo/cams/V1cam/images/M.jpg",
    refreshSeconds: 600,
    sourcePage: "https://www.usgs.gov/volcanoes/kilauea/webcams",
    provider: "USGS Hawaiian Volcano Observatory",
  },

  // --- South Atlantic, Patagonia and the Andes ---

  // Sure South Atlantic, the islands' telecom operator. Checked 2026-10-04:
  // frame stamped 11:50 local, seconds old.
  {
    id: "curated:sure-stanley-jetty",
    title: "Stanley public jetty",
    place: "Stanley",
    country: "Falkland Islands",
    lat: -51.6913,
    lon: -57.8583,
    category: "harbor",
    prominence: 8,
    stillUrl: "https://webcams.sure.co.fk/images/jetty.jpg",
    refreshSeconds: 120,
    sourcePage: "https://webcams.sure.co.fk/",
    provider: "Sure South Atlantic",
  },
  // British Antarctic Survey's Bird Island station, off the western tip of
  // South Georgia; the same latest.php endpoint as Halley above. Checked
  // 2026-10-05: frame stamped 03:01 UTC, half an hour old; new frames hourly.
  // At night the picture is sensor noise over a dark colony, not a fault.
  {
    id: "curated:bas-bird-island",
    title: "Bird Island Research Station",
    place: "Bird Island, South Georgia",
    country: "South Georgia and the South Sandwich Islands",
    lat: -54.0092,
    lon: -38.0507,
    category: "wildlife",
    prominence: 8,
    stillUrl: "https://legacy.bas.ac.uk/images/webcams/latest/latest.php?cam=birdisland",
    refreshSeconds: 1800,
    sourcePage: "https://www.bas.ac.uk/data/our-data/images/webcams/bird-island-webcam/",
    provider: "British Antarctic Survey",
  },

  // PhenoCam sites in southern Chile, kept by the Universidad de Magallanes
  // and the Senda Darwin station. Checked 2026-10-04, same terms as the African ones above.
  {
    id: "curated:phenocam-omora",
    title: "Omora peatland, Navarino Island",
    place: "Puerto Williams, Cape Horn Biosphere Reserve",
    country: "Chile",
    lat: -54.9394,
    lon: -67.6418,
    category: "weather",
    prominence: 7,
    ...phenocam("omorapeatland"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Cape Horn International Center",
  },
  {
    id: "curated:phenocam-senda-darwin",
    title: "Senda Darwin peatland, Chiloé",
    place: "Chiloé Island",
    country: "Chile",
    lat: -41.8793,
    lon: -73.6655,
    category: "weather",
    prominence: 6,
    ...phenocam("sendadarwinpeatland"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Senda Darwin Biological Station",
  },
  {
    id: "curated:phenocam-alerce-costero",
    title: "Alerce Costero National Park forest",
    place: "Alerce Costero National Park",
    country: "Chile",
    lat: -40.1726,
    lon: -73.4439,
    category: "weather",
    prominence: 6,
    ...phenocam("alercecosteroforest"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network",
  },

  // ESO and partner telescopes in the Atacama. Checked 2026-10-04: APEX and
  // the La Silla all-sky frame were seconds old. The Paranal panorama camera
  // sweeps its presets a few times a day; this one was three hours old.
  // ESO's ALMA and Armazones cameras were tried and are frozen, so they are not here.
  {
    id: "curated:apex-chajnantor",
    title: "APEX telescope, Chajnantor plateau",
    place: "Llano de Chajnantor",
    country: "Chile",
    lat: -23.0058,
    lon: -67.7592,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://www.apex-telescope.org/camera/images/10.0.6.84/image1.jpg",
    refreshSeconds: 120,
    sourcePage: "https://www.eso.org/public/outreach/webcams/",
    provider: "APEX / ESO",
  },
  {
    id: "curated:eso-paranal",
    title: "Paranal Observatory, Very Large Telescope",
    place: "Cerro Paranal",
    country: "Chile",
    lat: -24.6272,
    lon: -70.4042,
    category: "observatory",
    prominence: 8,
    stillUrl: "https://www.eso.org/public/archives/static/pano/latest/POI/preset_1.jpg",
    refreshSeconds: 3600,
    sourcePage: "https://www.eso.org/public/outreach/webcams/",
    provider: "ESO",
  },
  {
    id: "curated:lasilla-allsky",
    title: "La Silla all-sky camera, Danish 1.54 m telescope",
    place: "La Silla Observatory",
    country: "Chile",
    lat: -29.2575,
    lon: -70.7375,
    category: "observatory",
    prominence: 7,
    stillUrl: "https://allsky-dk154.asu.cas.cz/AllSkyCurrentImage.JPG",
    refreshSeconds: 120,
    sourcePage: "https://www.eso.org/public/outreach/webcams/",
    provider: "Astronomical Institute of the Czech Academy of Sciences / ESO",
  },

  // --- Tropical Americas ---

  // PhenoCam sites, checked 2026-10-04, same terms as the African ones above.
  {
    id: "curated:phenocam-mataflux",
    title: "MataFlux forest restoration planting",
    place: "São Paulo state",
    country: "Brazil",
    lat: -23.061,
    lon: -48.6463,
    category: "weather",
    prominence: 6,
    ...phenocam("mataflux"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / MataFlux",
  },
  {
    id: "curated:phenocam-barro-colorado",
    title: "Barro Colorado Island rainforest canopy",
    place: "Barro Colorado Island",
    country: "Panama",
    lat: 9.1582,
    lon: -79.8475,
    category: "weather",
    prominence: 7,
    ...phenocam("barrocolorado"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Smithsonian Tropical Research Institute",
  },
  {
    id: "curated:phenocam-la-selva",
    title: "La Selva Biological Station rainforest",
    place: "La Selva",
    country: "Costa Rica",
    lat: 10.4303,
    lon: -84.0071,
    category: "weather",
    prominence: 6,
    ...phenocam("laselva2"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / La Selva Biological Station",
  },
  {
    id: "curated:phenocam-monkey-bay",
    title: "Pine savanna, Monkey Bay Wildlife Sanctuary",
    place: "Monkey Bay Wildlife Sanctuary",
    country: "Belize",
    lat: 17.3192,
    lon: -88.5671,
    category: "weather",
    prominence: 6,
    ...phenocam("mbaysavanna"),
    refreshSeconds: 1800,
    provider: "PhenoCam Network / Monkey Bay Wildlife Sanctuary",
  },

  // OVSICORI, Universidad Nacional de Costa Rica. Checked 2026-10-04: all
  // three frames were under a minute old. Its Turrialba camera was three
  // days stale and is left out.
  {
    id: "curated:ovsicori-poas",
    title: "Poás volcano crater",
    place: "Poás Volcano",
    country: "Costa Rica",
    lat: 10.1978,
    lon: -84.2306,
    category: "volcano",
    prominence: 8,
    stillUrl: "https://www.ovsicori.una.ac.cr/images/stories/camaras/livecraterpoas/camara.jpg",
    refreshSeconds: 300,
    sourcePage: "https://www.ovsicori.una.ac.cr/index.php/camaras",
    provider: "OVSICORI-UNA",
  },
  {
    id: "curated:ovsicori-irazu",
    title: "Irazú volcano",
    place: "Irazú Volcano",
    country: "Costa Rica",
    lat: 9.979,
    lon: -83.852,
    category: "volcano",
    prominence: 7,
    stillUrl: "https://www.ovsicori.una.ac.cr/images/stories/camaras/liveirazu/camara.jpg",
    refreshSeconds: 300,
    sourcePage: "https://www.ovsicori.una.ac.cr/index.php/camaras",
    provider: "OVSICORI-UNA",
  },
  {
    id: "curated:ovsicori-rincon",
    title: "Rincón de la Vieja volcano",
    place: "Rincón de la Vieja",
    country: "Costa Rica",
    lat: 10.83,
    lon: -85.324,
    category: "volcano",
    prominence: 7,
    stillUrl: "https://www.ovsicori.una.ac.cr/images/stories/camaras/liverincon/camara.jpg",
    refreshSeconds: 300,
    sourcePage: "https://www.ovsicori.una.ac.cr/index.php/camaras",
    provider: "OVSICORI-UNA",
  },
];

export interface Promotion {
  title?: string;
  place?: string;
  category?: CamCategory;
  /** 1-10; landmark-grade cameras sit at 6-8 so they beat their neighbours without outranking a volcano. */
  prominence?: number;
}

/**
 * Camera id -> overrides. Ids are `<source>:<localId>` exactly as the
 * adapters build them, and each one below was confirmed present in its
 * live feed. An id that disappears upstream is simply skipped, so a
 * decommissioned camera degrades to "not promoted" rather than breaking
 * the catalogue.
 */
export const PROMOTIONS: Record<string, Promotion> = {
  // San Francisco Bay
  "caltrans:d4-tvd32i80baybridgesastowereast": {
    title: "Bay Bridge — SAS Tower, east",
    place: "San Francisco",
    category: "city",
    prominence: 7,
  },
  "caltrans:d4-tvd33i80baybridgesastowerwest": {
    title: "Bay Bridge — SAS Tower, west",
    place: "San Francisco",
    category: "city",
    prominence: 7,
  },
  "caltrans:d4-tv388sr1justsouthofpresidiotunnel": {
    title: "Presidio — approach to the Golden Gate",
    place: "San Francisco",
    category: "city",
    prominence: 7,
  },

  // London
  "tfl:JamCams_00001.07450": {
    title: "Piccadilly Circus",
    place: "London",
    category: "city",
    prominence: 8,
  },
  "tfl:JamCams_00001.03500": {
    title: "Tower Bridge approach",
    place: "London",
    category: "city",
    prominence: 8,
  },
  "tfl:JamCams_00001.08750": {
    title: "Hyde Park Corner",
    place: "London",
    category: "city",
    prominence: 7,
  },
  "tfl:JamCams_00001.06510": {
    title: "Westminster Bridge Road",
    place: "London",
    category: "city",
    prominence: 7,
  },
  "tfl:JamCams_00001.08858": {
    title: "Oxford Street at Orchard Street",
    place: "London",
    category: "city",
    prominence: 6,
  },
};

export const curatedSource: CamSource = {
  key: "curated",
  label: "Hand-picked cameras",
  async fetchCams() {
    return STANDALONE_CAMS;
  },
};
