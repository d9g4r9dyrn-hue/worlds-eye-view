"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Session context for the client tree.
 *
 * Mounted unconditionally, even when accounts are switched off: with no
 * providers configured the session endpoint simply returns null and every
 * consumer sees "unauthenticated", which is exactly the anonymous
 * behaviour. Conditionally mounting it would mean the hooks throw instead.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
