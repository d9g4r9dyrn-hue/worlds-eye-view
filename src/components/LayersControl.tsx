"use client";

import { useState } from "react";
import type { CamCategory } from "@/lib/cams/types";
import { CATEGORY_LABELS } from "@/lib/cams/display";
import type { BaseMap, MapLayersState } from "@/lib/cams/mapLayers";

/**
 * Map control for choosing which cameras to show.
 *
 * Two independent axes, because they answer different questions. "Type"
 * is what you're looking at — volcanoes, harbours, roads. "Operator" is
 * who runs it, which is the only way to say something like "just the
 * Florida DOT cameras" or "only Transport for London": every one of those
 * is type `traffic`, so a type filter alone can't separate them.
 *
 * Counts come from the server and are for everything in view, not just
 * what survived thinning — so a layer showing 1,204 will genuinely give
 * you volcano cameras when you isolate it, even though none of them won
 * a slot while roads were switched on.
 */

export interface Facet {
  key: string;
  count: number;
}

export interface LayersState {
  /** null means "all" — distinct from an empty set, which means "none". */
  categories: Set<string> | null;
  providers: Set<string> | null;
}

function toggle(current: Set<string> | null, key: string, allKeys: string[]): Set<string> | null {
  // `null` (all) has to be materialised before one item can be removed,
  // otherwise the first click would read as "only this one".
  const base = current ?? new Set(allKeys);
  const next = new Set(base);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next.size === allKeys.length ? null : next;
}

function FacetRow({
  label,
  count,
  checked,
  onToggle,
  onOnly,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
  onOnly: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-wev-panel-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-3.5 w-3.5 shrink-0 accent-sky-400"
        />
        <span className={`truncate text-xs ${checked ? "text-wev-text" : "text-wev-muted"}`}>{label}</span>
      </label>
      <button
        type="button"
        onClick={onOnly}
        className="shrink-0 rounded px-1 text-[10px] uppercase tracking-wide text-wev-muted opacity-0 transition-opacity hover:text-wev-accent focus:opacity-100 group-hover:opacity-100"
        title={`Show only ${label}`}
      >
        only
      </button>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-wev-muted">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-wev-panel-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 shrink-0 accent-sky-400" />
      <span className={`text-xs ${checked ? "text-wev-text" : "text-wev-muted"}`}>{label}</span>
    </label>
  );
}

export function LayersControl({
  categoryFacets,
  providerFacets,
  state,
  onChange,
  mapLayers,
  onMapLayersChange,
}: {
  categoryFacets: Facet[];
  providerFacets: Facet[];
  state: LayersState;
  onChange: (next: LayersState) => void;
  mapLayers: MapLayersState;
  onMapLayersChange: (next: MapLayersState) => void;
}) {
  const [open, setOpen] = useState(false);

  const categoryKeys = categoryFacets.map((facet) => facet.key);
  const providerKeys = providerFacets.map((facet) => facet.key);

  const filtered = state.categories !== null || state.providers !== null;
  const isOn = (set: Set<string> | null, key: string) => set === null || set.has(key);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg border border-wev-border bg-wev-panel/95 px-2 py-1.5 text-[11px] font-medium text-wev-text shadow-lg backdrop-blur-sm transition-colors hover:bg-wev-panel-2 sm:gap-2 sm:px-2.5 sm:py-2 sm:text-xs"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-wev-accent sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="m12 3 9 5-9 5-9-5 9-5Z" />
            <path d="m3.5 12.5 8.5 4.7 8.5-4.7" />
          </svg>
          Layers
          {filtered && <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-wev-accent">filtered</span>}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 text-wev-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[1100] mt-1.5 w-[16.5rem] max-w-[calc(100vw-1.5rem)] mt-1.5 max-h-[min(32rem,calc(100dvh-9rem))] overflow-y-auto rounded-lg border border-wev-border bg-wev-panel/97 p-2 shadow-2xl backdrop-blur-sm">
          <div className="mb-1 px-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wev-muted">Map</span>
          </div>
          <div className="mb-1 flex gap-1 px-1.5">
            {(["satellite", "streets"] as BaseMap[]).map((base) => (
              <button
                key={base}
                type="button"
                onClick={() => onMapLayersChange({ ...mapLayers, base })}
                className={`flex-1 rounded border px-2 py-1 text-[11px] capitalize transition-colors ${
                  mapLayers.base === base
                    ? "border-sky-700 bg-sky-400/10 text-wev-accent"
                    : "border-wev-border bg-wev-panel-2 text-wev-muted hover:text-wev-text"
                }`}
              >
                {base}
              </button>
            ))}
          </div>
          <Toggle
            label="Roads"
            checked={mapLayers.roads}
            onChange={() => onMapLayersChange({ ...mapLayers, roads: !mapLayers.roads })}
          />
          <Toggle
            label="Place names"
            checked={mapLayers.places}
            onChange={() => onMapLayersChange({ ...mapLayers, places: !mapLayers.places })}
          />
          <Toggle
            label="Weather radar"
            checked={mapLayers.weather}
            onChange={() => onMapLayersChange({ ...mapLayers, weather: !mapLayers.weather })}
          />

          <div className="mb-1 mt-3 flex items-center justify-between px-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wev-muted">Camera type</span>
            {state.categories !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...state, categories: null })}
                className="text-[10px] text-wev-accent hover:underline"
              >
                reset
              </button>
            )}
          </div>
          {categoryFacets.map((facet) => (
            <FacetRow
              key={facet.key}
              label={CATEGORY_LABELS[facet.key as CamCategory] ?? facet.key}
              count={facet.count}
              checked={isOn(state.categories, facet.key)}
              onToggle={() => onChange({ ...state, categories: toggle(state.categories, facet.key, categoryKeys) })}
              onOnly={() => onChange({ ...state, categories: new Set([facet.key]) })}
            />
          ))}

          <div className="mb-1 mt-3 flex items-center justify-between px-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-wev-muted">Operator</span>
            {state.providers !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...state, providers: null })}
                className="text-[10px] text-wev-accent hover:underline"
              >
                reset
              </button>
            )}
          </div>
          {providerFacets.map((facet) => (
            <FacetRow
              key={facet.key}
              label={facet.key}
              count={facet.count}
              checked={isOn(state.providers, facet.key)}
              onToggle={() => onChange({ ...state, providers: toggle(state.providers, facet.key, providerKeys) })}
              onOnly={() => onChange({ ...state, providers: new Set([facet.key]) })}
            />
          ))}

          {filtered && (
            <button
              type="button"
              onClick={() => onChange({ categories: null, providers: null })}
              className="mt-3 w-full rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
            >
              Show everything
            </button>
          )}
        </div>
      )}
    </div>
  );
}
