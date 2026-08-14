"use client";

import { useEffect } from "react";

/**
 * What this is and where the pictures come from.
 *
 * The attribution here isn't decorative — every camera on the map belongs
 * to a public agency that publishes it for free, and naming them is the
 * least this owes them.
 */

const SOURCES: { name: string; detail: string; href: string }[] = [
  {
    name: "State & provincial 511 services",
    detail: "Florida, Georgia, Utah, North Carolina, New York, Pennsylvania, Nevada, Arizona, Idaho, Wisconsin, Connecticut, Louisiana, Alaska, New England, and Ontario, Alberta, Manitoba, Yukon, New Brunswick, Nova Scotia, Newfoundland & Labrador and PEI",
    href: "https://fl511.com",
  },
  { name: "Caltrans", detail: "California highway CCTV", href: "https://cwwp2.dot.ca.gov/vm/iframemap.htm" },
  { name: "DriveBC", detail: "British Columbia highway cameras", href: "https://www.drivebc.ca/" },
  { name: "Fintraffic", detail: "Road weather cameras across Finland", href: "https://liikennetilanne.fintraffic.fi/" },
  {
    name: "NZ Transport Agency Waka Kotahi",
    detail: "State highway cameras across New Zealand",
    href: "https://www.journeys.nzta.govt.nz/traffic-cameras",
  },
  { name: "LTA Singapore", detail: "Expressway cameras, via data.gov.sg", href: "https://data.gov.sg" },
  { name: "Transport for London", detail: "JamCams across Greater London", href: "https://www.tfl.gov.uk/traffic/status" },
  {
    name: "USGS Alaska Volcano Observatory",
    detail: "Cameras watching active volcanoes and the communities downwind",
    href: "https://avo.alaska.edu/webcam/",
  },
  { name: "Esri", detail: "World Imagery basemap", href: "https://www.esri.com" },
];

export function AboutPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-wev-border bg-wev-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wev-border px-5 py-3">
          <h2 className="text-sm font-semibold text-wev-text">About World&rsquo;s Eye View</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm leading-relaxed text-wev-muted">
          <p>
            Thousands of <strong className="font-medium text-wev-text">public webcams</strong>, stitched onto one
            satellite map as live thumbnails. Zoom out and you see the notable ones; zoom in and a city fills with
            windows. Click any of them to watch full size, or send several to the{" "}
            <strong className="font-medium text-wev-text">multicam</strong> wall and watch them together.
          </p>
          <p>
            Frames refresh on each camera&rsquo;s own schedule, so the map drifts through the day with the world —
            dawn creeping across a continent, a city going dark hours before its neighbour.
          </p>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wev-text">Cameras come from</h3>
            <ul className="space-y-2">
              {SOURCES.map((source) => (
                <li key={source.name}>
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-wev-accent hover:underline"
                  >
                    {source.name}
                  </a>
                  <span className="block text-xs text-wev-muted">{source.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs">
            Every camera here is published publicly by the organisation that operates it. Nothing is private, nothing
            is scraped from a closed system, and frames are passed through unmodified apart from being resized. A
            camera that stops responding simply disappears from the map until it comes back.
          </p>

          <p className="text-xs">
            Built by{" "}
            <a href="https://corticorp.com" target="_blank" rel="noopener noreferrer" className="text-wev-accent hover:underline">
              CortiCorp
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
