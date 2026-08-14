"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { PublicCam } from "./cams/types";

/**
 * Saved camera walls for the signed-in user.
 *
 * Signed out, this reports an empty list and the wall keeps living in
 * localStorage exactly as before — saving is an addition for people with
 * an account, never a replacement for the anonymous experience.
 *
 * Note the shape here: nothing is *cleared* in response to signing out.
 * Both the visible list and the active selection are derived from
 * `signedIn` during render, so there's no window where a previous user's
 * wall names are still on screen, and no effect whose only job is to
 * undo state.
 */

export interface SavedDashboard {
  id: number;
  name: string;
  cams: PublicCam[];
  columns: number | null;
  updatedAt: string;
}

export function useDashboards() {
  const { status } = useSession();
  const signedIn = status === "authenticated";

  const [fetched, setFetched] = useState<SavedDashboard[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const dashboards = signedIn ? fetched : [];
  const activeId = dashboards.some((item) => item.id === selectedId) ? selectedId : null;

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const response = await fetch("/api/dashboards");
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { dashboards: SavedDashboard[] };
      setFetched(payload.dashboards ?? []);
    } catch {
      setFetched([]);
    }
  }, [signedIn]);

  useEffect(() => {
    // Fetching on mount and on sign-in change is exactly what an effect
    // is for. The lint rule flags this because it can't see through the
    // async boundary: every setFetched inside `refresh` happens *after*
    // `await fetch(...)`, so none of them can run synchronously during
    // this effect and none can cascade a render here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const create = useCallback(async (name: string, cams: PublicCam[], columns: number | null) => {
    const response = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cams, columns }),
    });
    if (!response.ok) return null;
    const { dashboard } = (await response.json()) as { dashboard: SavedDashboard };
    setFetched((current) => [dashboard, ...current]);
    setSelectedId(dashboard.id);
    return dashboard;
  }, []);

  const update = useCallback(
    async (id: number, patch: { name?: string; cams?: PublicCam[]; columns?: number | null }) => {
      const response = await fetch(`/api/dashboards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return null;
      const { dashboard } = (await response.json()) as { dashboard: SavedDashboard };
      setFetched((current) => current.map((item) => (item.id === id ? dashboard : item)));
      return dashboard;
    },
    []
  );

  const remove = useCallback(async (id: number) => {
    const response = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
    if (!response.ok) return false;
    setFetched((current) => current.filter((item) => item.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    return true;
  }, []);

  return { signedIn, dashboards, activeId, setActiveId: setSelectedId, refresh, create, update, remove };
}
