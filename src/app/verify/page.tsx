"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * The landing page for the emailed confirmation link.
 *
 * The token is spent by a POST this page makes on submit, never by its own
 * load. Mail clients and corporate scanners routinely fetch every link in a
 * message to check it for malware, and a GET that consumed the token would
 * let that scan burn the link before the recipient ever clicked it, a
 * genuinely common way for verification flows to appear broken.
 *
 * It asks for the password chosen at sign-up, because the link alone only
 * proves who holds the inbox. Anybody can type somebody else's address into
 * the sign-up form, so the password is what tells the two apart. See
 * src/app/api/auth/verify/route.ts.
 */

const FIELD =
  "w-full rounded border border-wev-border bg-wev-panel-2 px-2.5 py-2 text-sm text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700";

type State = { status: "idle" | "working" | "done" } | { status: "failed"; error: string };

function VerifyInner() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || state.status === "working") return;
    setState({ status: "working" });
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ status: "failed", error: data?.error ?? "That link didn't work." });
        return;
      }
      setState({ status: "done" });
    } catch {
      setState({ status: "failed", error: "Network error, try again." });
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16 text-center">
      {state.status === "done" ? (
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
      ) : !token ? (
        <>
          <h1 className="mb-2 text-lg font-semibold text-wev-text">That link didn&rsquo;t work</h1>
          <p className="mb-6 text-sm text-wev-muted">That link is missing its token. Open the link from your email again.</p>
          <Link
            href="/"
            className="mx-auto rounded border border-wev-border bg-wev-panel-2 px-4 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
          >
            Back to the map
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="text-left">
          <h1 className="mb-2 text-center text-lg font-semibold text-wev-text">Confirm your email</h1>
          <p className="mb-5 text-center text-sm text-wev-muted">
            Enter the password you chose when you signed up. It confirms this link is yours.
          </p>
          <label className="mb-1.5 block text-[11px] text-wev-muted" htmlFor="verify-password">
            Password
          </label>
          <input
            id="verify-password"
            type="password"
            autoComplete="current-password"
            className={FIELD}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
          {state.status === "failed" && <p className="mt-3 text-xs text-rose-400">{state.error}</p>}
          <button
            type="submit"
            disabled={state.status === "working"}
            className="mt-4 w-full rounded border border-wev-border bg-wev-panel-2 px-4 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-50"
          >
            {state.status === "working" ? "Confirming…" : "Confirm and sign in"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts
  // out of static rendering.
  return (
    <Suspense fallback={<p className="p-16 text-center text-sm text-wev-muted">Loading…</p>}>
      <VerifyInner />
    </Suspense>
  );
}
