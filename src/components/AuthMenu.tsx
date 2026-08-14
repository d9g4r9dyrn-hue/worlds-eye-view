"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

/**
 * Sign-in, and the account menu once signed in.
 *
 * Renders nothing at all when accounts aren't configured, so the header
 * doesn't advertise a feature that would fail on click. Signing in is
 * never required to use the map — it exists purely to keep more than one
 * saved camera wall.
 */
export function AuthMenu({ enabled }: { enabled: boolean }) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!enabled) return null;

  if (status !== "authenticated") {
    return (
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={status === "loading"}
        className="rounded px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text disabled:opacity-50"
      >
        Sign in
      </button>
    );
  }

  const user = session.user;
  const label = user?.name || user?.email || "Account";

  const onDeleteAccount = async () => {
    if (!window.confirm("Delete your account and every saved wall? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (response.ok) {
        await signOut({ callbackUrl: "/" });
      } else {
        window.alert("Couldn't delete the account. Please try again.");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
      >
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Google avatar URL; next/image would need googleusercontent in remotePatterns and in the CSP
          <img src={user.image} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-wev-panel-2 text-[10px] uppercase">
            {label.charAt(0)}
          </span>
        )}
        <span className="hidden max-w-[9rem] truncate sm:inline">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-lg border border-wev-border bg-wev-panel p-1 shadow-2xl">
          <p className="truncate px-2.5 py-1.5 text-[11px] text-wev-muted">{user?.email}</p>
          <Link
            href="/privacy"
            className="block rounded px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            Privacy
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={onDeleteAccount}
            disabled={deleting}
            className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      )}
    </div>
  );
}
