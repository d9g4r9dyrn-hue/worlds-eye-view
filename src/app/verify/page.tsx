"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * The landing page for the emailed confirmation link.
 *
 * The token is consumed by a POST, not by this page's own load. Mail
 * clients and corporate scanners routinely fetch every link in a message
 * to check it for malware, and a GET that consumed the token would let
 * that scan burn the link before the recipient ever clicked it — a
 * genuinely common way for verification flows to appear broken.
 */

type State = { status: "working" } | { status: "done" } | { status: "failed"; error: string };

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  // A missing token is knowable at render time, so it's the initial
  // state rather than something an effect discovers and then corrects.
  const [state, setState] = useState<State>(() =>
    token ? { status: "working" } : { status: "failed", error: "That link is missing its token." }
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "failed", error: data?.error ?? "That link didn't work." });
          return;
        }
        setState({ status: "done" });
      } catch {
        if (!cancelled) setState({ status: "failed", error: "Network error — try the link again." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16 text-center">
      {state.status === "working" && <p className="text-sm text-wev-muted">Confirming your email…</p>}

      {state.status === "done" && (
        <>
          <h1 className="mb-2 text-lg font-semibold text-wev-text">You&rsquo;re all set</h1>
          <p className="mb-6 text-sm text-wev-muted">
            Your email is confirmed and you&rsquo;re signed in. Saved walls will now follow your account.
          </p>
          <Link
            href="/"
            className="mx-auto rounded border border-wev-border bg-wev-panel-2 px-4 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
          >
            Back to the map
          </Link>
        </>
      )}

      {state.status === "failed" && (
        <>
          <h1 className="mb-2 text-lg font-semibold text-wev-text">That link didn&rsquo;t work</h1>
          <p className="mb-6 text-sm text-wev-muted">{state.error}</p>
          <Link
            href="/"
            className="mx-auto rounded border border-wev-border bg-wev-panel-2 px-4 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
          >
            Back to the map
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts
  // out of static rendering.
  return (
    <Suspense fallback={<p className="p-16 text-center text-sm text-wev-muted">Confirming…</p>}>
      <VerifyInner />
    </Suspense>
  );
}
