import type { Cam, CamCategory, CamSource } from "../types";

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

/** Cameras with no feed behind them. See the note above on why this list is short. */
const STANDALONE_CAMS: Cam[] = [];

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
