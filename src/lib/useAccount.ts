"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Who's signed in, from the client's point of view.
 *
 * Replaces next-auth's `useSession`. The session cookie is httpOnly, so
 * the browser genuinely cannot tell on its own — this asks the server
 * once on mount and again whenever something changes it.
 *
 * `accountsEnabled` is separate from `user` on purpose: a deployment
 * with no DATABASE_URL has no accounts at all, and the UI should hide
 * sign-in entirely rather than offer a button that fails.
 */

export interface AccountUser {
  id: number;
  email: string;
  name: string | null;
}

/**
 * The bare request, with no state attached.
 *
 * Split out so the mount effect can await it and set state once, rather
 * than calling a setState-containing callback from the effect body.
 *
 * A failed check reports "guest": the map works signed out, so a blip
 * degrades to the anonymous experience rather than an error screen.
 */
async function readAccount(): Promise<{ accountsEnabled: boolean; user: AccountUser | null }> {
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    const data = (await response.json()) as { accountsEnabled?: boolean; user?: AccountUser | null };
    return { accountsEnabled: Boolean(data.accountsEnabled), user: data.user ?? null };
  } catch {
    return { accountsEnabled: false, user: null };
  }
}

export function useAccount() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  /** Re-reads after sign-in, sign-out, or anything else that changes it. */
  const refresh = useCallback(async () => {
    const result = await readAccount();
    setAccountsEnabled(result.accountsEnabled);
    setUser(result.user);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await readAccount();
      // Guarded so a request still in flight when the component unmounts
      // can't set state afterwards.
      if (cancelled) return;
      setAccountsEnabled(result.accountsEnabled);
      setUser(result.user);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, accountsEnabled, loading, refresh, signedIn: user !== null };
}
