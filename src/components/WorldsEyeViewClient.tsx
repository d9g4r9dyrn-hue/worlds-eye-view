"use client";

import dynamic from "next/dynamic";

/**
 * Leaflet reaches for `window` at module scope, so the map can only ever
 * be loaded in the browser. `ssr: false` is a client-component-only
 * option, which is the whole reason this thin wrapper exists between the
 * server page and the map.
 */
const WorldsEyeMap = dynamic(() => import("./WorldsEyeMap").then((mod) => mod.WorldsEyeMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-wev-muted">Loading the map…</div>
  ),
});

export function WorldsEyeViewClient() {
  // The opening view comes from the query string, read inside the map
  // from window.location rather than server-side searchParams — touching
  // searchParams here would force the page out of static prerendering.
  return <WorldsEyeMap />;
}
