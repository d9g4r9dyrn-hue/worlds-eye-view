"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/useAccount";

/**
 * Sign in, register, and the account menu once signed in.
 *
 * Email and password rather than SSO. Nothing here is required to use
 * the map — an account exists to keep more than one saved wall and to
 * publish one, and the map is deliberately fully usable without it.
 */

type Mode = "signin" | "register";

const FIELD =
  "w-full rounded border border-wev-border bg-wev-panel-2 px-2.5 py-2 text-xs text-wev-text outline-none placeholder:text-wev-muted focus:border-sky-700";

export function AccountMenu() {
  const { accountsEnabled, user, loading, refresh } = useAccount();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const url = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "signin" ? { email, password } : { email, password, name }
          ),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setError(data?.error ?? "That didn't work.");
          return;
        }

        if (mode === "register") {
          // Registration deliberately does not sign you in — the emailed
          // link is what proves the address is yours.
          setNotice(data?.message ?? "Check your email for a confirmation link.");
          setPassword("");
          return;
        }

        setPassword("");
        setOpen(false);
        await refresh();
      } catch {
        setError("Network error — try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, email, password, name, refresh]
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setOpen(false);
    await refresh();
  }, [refresh]);

  // Renders nothing rather than a control that would fail on click.
  if (!accountsEnabled || loading) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
          setNotice(null);
        }}
        className="flex items-center gap-1.5 rounded border border-wev-border bg-wev-panel-2 px-2.5 py-1 text-xs text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
        </svg>
        <span className="max-w-[9rem] truncate">{user ? (user.name || user.email) : "Sign in"}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-[1600] mt-1.5 w-64 rounded-lg border border-wev-border bg-wev-panel/98 p-3 shadow-2xl backdrop-blur-sm">
          {user ? (
            <>
              <p className="truncate text-[11px] text-wev-muted">Signed in as</p>
              <p className="mb-2.5 truncate text-xs text-wev-text">{user.email}</p>
              <button
                type="button"
                onClick={signOut}
                className="w-full rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="mb-2.5 flex gap-1 rounded border border-wev-border bg-wev-panel-2 p-0.5">
                {(
                  [
                    ["signin", "Sign in"],
                    ["register", "Create account"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value);
                      setError(null);
                      setNotice(null);
                    }}
                    className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                      mode === value ? "bg-sky-400/15 text-wev-accent" : "text-wev-muted hover:text-wev-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-2">
                {mode === "register" && (
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Name (optional)"
                    autoComplete="name"
                    className={FIELD}
                  />
                )}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  required
                  className={FIELD}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
                  // Tells a password manager which of the two this is, so
                  // it offers to save on register and fill on sign-in.
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  className={FIELD}
                />
                <button
                  type="submit"
                  disabled={busy || !email || !password}
                  className="w-full rounded border border-wev-border bg-wev-panel-2 py-1.5 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent disabled:opacity-40"
                >
                  {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>

              {mode === "signin" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!email) {
                      setError("Enter your email address first.");
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    setNotice(null);
                    try {
                      const response = await fetch("/api/auth/forgot", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email }),
                      });
                      const data = await response.json().catch(() => ({}));
                      setNotice(data?.message ?? "If that address has an account, a reset link is on its way.");
                    } catch {
                      setError("Network error — try again.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="mt-2 w-full text-center text-[10px] text-wev-muted underline transition-colors hover:text-wev-text disabled:opacity-40"
                >
                  Forgot your password?
                </button>
              )}

              {mode === "register" && (
                <p className="mt-2 text-[10px] leading-tight text-wev-muted">
                  Your email is used to confirm the account and nothing else. See the{" "}
                  <Link href="/privacy" className="underline hover:text-wev-text">
                    privacy note
                  </Link>
                  .
                </p>
              )}
            </>
          )}

          {error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{error}</p>}
          {notice && <p className="mt-2 rounded bg-sky-400/10 px-2 py-1.5 text-[11px] text-wev-accent">{notice}</p>}
        </div>
      )}
    </div>
  );
}
