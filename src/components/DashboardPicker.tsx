"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicCam } from "@/lib/cams/types";
import type { SavedDashboard } from "@/lib/useDashboards";

/**
 * Load, save and manage named camera walls.
 *
 * Only appears when signed in — signed out, the single localStorage wall
 * is the whole feature and a picker would be noise.
 */
export function DashboardPicker({
  dashboards,
  activeId,
  currentCams,
  currentColumns,
  onLoad,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
}: {
  dashboards: SavedDashboard[];
  activeId: number | null;
  currentCams: PublicCam[];
  currentColumns: number | null;
  onLoad: (dashboard: SavedDashboard) => void;
  onCreate: (name: string, cams: PublicCam[], columns: number | null) => Promise<unknown>;
  onUpdate: (id: number, patch: { cams?: PublicCam[]; columns?: number | null }) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = dashboards.find((item) => item.id === activeId) ?? null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const saveAsNew = () =>
    run(async () => {
      const name = window.prompt("Name this wall", `Wall ${dashboards.length + 1}`);
      if (name === null) return;
      await onCreate(name, currentCams, currentColumns);
      setOpen(false);
    });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[11rem] items-center gap-1.5 rounded border border-wev-border bg-wev-panel-2 px-2 py-1 text-[11px] text-wev-text transition-colors hover:border-sky-700"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-wev-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
        </svg>
        <span className="truncate">{active ? active.name : "Unsaved wall"}</span>
        <svg viewBox="0 0 24 24" className={`h-3 w-3 shrink-0 text-wev-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-[1600] mt-1.5 w-64 rounded-lg border border-wev-border bg-wev-panel p-1 shadow-2xl">
          {dashboards.length > 0 && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-wev-muted">Your walls</p>
              <div className="max-h-56 overflow-y-auto">
                {dashboards.map((dashboard) => (
                  <div
                    key={dashboard.id}
                    className={`group flex items-center gap-1 rounded px-1 hover:bg-wev-panel-2 ${
                      dashboard.id === activeId ? "bg-sky-400/10" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onLoad(dashboard);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate px-1 py-1.5 text-left text-xs text-wev-text"
                    >
                      {dashboard.name}
                      <span className="ml-1.5 text-[10px] text-wev-muted">{dashboard.cams.length}</span>
                    </button>
                    <button
                      type="button"
                      title="Rename"
                      onClick={() =>
                        run(async () => {
                          const name = window.prompt("Rename wall", dashboard.name);
                          if (name === null) return;
                          await onRename(dashboard.id, name);
                        })
                      }
                      className="shrink-0 rounded p-1 text-wev-muted opacity-0 hover:text-wev-text focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() =>
                        run(async () => {
                          if (!window.confirm(`Delete "${dashboard.name}"?`)) return;
                          await onDelete(dashboard.id);
                        })
                      }
                      className="shrink-0 rounded p-1 text-wev-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="my-1 border-t border-wev-border" />
            </>
          )}

          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onUpdate(active.id, { cams: currentCams, columns: currentColumns }))}
              className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-wev-text transition-colors hover:bg-wev-panel-2 disabled:opacity-50"
            >
              Save changes to &ldquo;{active.name}&rdquo;
            </button>
          )}
          <button
            type="button"
            disabled={busy || currentCams.length === 0}
            onClick={saveAsNew}
            className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-wev-text transition-colors hover:bg-wev-panel-2 disabled:opacity-40"
          >
            Save as a new wall…
          </button>
          {currentCams.length === 0 && (
            <p className="px-2.5 pb-1 text-[10px] text-wev-muted">Add cameras before saving.</p>
          )}
        </div>
      )}
    </div>
  );
}
