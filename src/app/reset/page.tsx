"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * Choose a new password from a reset link.
 *
 * Unlike /verify, nothing happens on load: the token is spent only when
 * the form is submitted, because there is no new password to set until
 * then. That also means a link-scanning mail client can't burn it.
 */

function ResetInner() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !token) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "That didn't work.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-16">
      {done ? (
        <div className="text-center">
          <h1 className="mb-2 text-lg font-semibold text-wev-text">Password changed</h1>
          <p className="mb-6 text-sm text-wev-muted">
            You&rsquo;re signed in here, and signed out everywhere else.
          </p>
          <Link
            href="/"
            className="rounded border border-wev-border bg-wev-panel-2 px-4 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
          >
            Back to the map
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mb-4 text-lg font-semibold text-wev-text">Choose a new password</h1>
          {!token ? (
            <p className="text-sm text-wev-muted">That link is missing its token.</p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="New password (10+ characters)"
                autoComplete="new-password"
                required
                className="w-full rounded border border-wev-border bg-wev-panel-2 px-2.5 py-2 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700"
              />
              <button
                type="submit"
                disabled={busy || password.length < 10}
                className="w-full rounded border border-wev-border bg-wev-panel-2 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
              >
                {busy ? "Saving…" : "Set password"}
              </button>
            </form>
          )}
          {error && <p className="mt-3 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<p className="p-16 text-center text-sm text-wev-muted">Loading…</p>}>
      <ResetInner />
    </Suspense>
  );
}
