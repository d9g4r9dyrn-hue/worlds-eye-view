"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  onSetPublic,
  onMove,
}: {
  dashboards: SavedDashboard[];
  activeId: number | null;
  currentCams: PublicCam[];
  currentColumns: number | null;
  onLoad: (dashboard: SavedDashboard) => void;
  onCreate: (name: string, cams: PublicCam[], columns: number | null, folder?: string) => Promise<unknown>;
  onSetPublic: (id: number, isPublic: boolean) => Promise<unknown>;
  onMove: (id: number, folder: string) => Promise<unknown>;
  onUpdate: (id: number, patch: { cams?: PublicCam[]; columns?: number | null }) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * The flat list, bucketed by folder path.
   *
   * Derived at render rather than stored: the folder is a field on each
   * dashboard, so a tree kept alongside it would be a second copy of the
   * same fact and a chance for the two to disagree after a move. Root
   * ("") sorts first so unfiled walls stay at the top where they were
   * before folders existed.
   */
  const grouped = useMemo(() => {
    const buckets = new Map<string, SavedDashboard[]>();
    for (const dashboard of dashboards) {
      const key = dashboard.folder ?? "";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(dashboard);
      else buckets.set(key, [dashboard]);
    }
    return [...buckets.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [dashboards]);
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
                {grouped.map(([folder, items]: [string, SavedDashboard[]]) => (
                  <div key={folder || "(root)"}>
                    {folder && (
                      // Path shown whole rather than as an indented tree.
                      // Nesting is virtual and usually one or two levels,
                      // and "sunsets / italy" reads faster in a 16rem
                      // dropdown than an indent the eye has to measure.
                      <p className="truncate px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-wev-muted">
                        {folder.split("/").join(" / ")}
                      </p>
                    )}
                    {items.map((dashboard: SavedDashboard) => (
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
                      title={dashboard.isPublic ? "Public — click to make private" : "Private — click to publish"}
                      onClick={() => run(() => onSetPublic(dashboard.id, !dashboard.isPublic))}
                      className={`shrink-0 rounded p-1 ${
                        dashboard.isPublic
                          ? "text-wev-accent"
                          : "text-wev-muted opacity-0 hover:text-wev-text focus:opacity-100 group-hover:opacity-100"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        {dashboard.isPublic ? (
                          <>
                            <circle cx="12" cy="12" r="9" />
                            <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                          </>
                        ) : (
                          <>
                            <rect x="5" y="11" width="14" height="9" rx="1.5" />
                            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                          </>
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="Move to folder"
                      onClick={() =>
                        run(async () => {
                          const folder = window.prompt(
                            "Folder (use / to nest, blank for none)",
                            dashboard.folder
                          );
                          if (folder === null) return;
                          await onMove(dashboard.id, folder);
                        })
                      }
                      className="shrink-0 rounded p-1 text-wev-muted opacity-0 hover:text-wev-text focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3Z" />
                      </svg>
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
