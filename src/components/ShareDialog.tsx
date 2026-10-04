"use client";

import { useEffect, useRef, useState } from "react";
import { previewImagePath, viewQuery, type ShareView } from "@/lib/share/view";

/**
 * Share the current view, or one camera.
 *
 * The link is the same address the map already keeps in the address bar,
 * so there is nothing to generate or store: opening it puts the map back
 * where it was, with the camera panel open if the link names a camera.
 *
 * The dialog shows the picture the platforms will show. That is partly
 * so the person sharing knows what they are about to post, and partly
 * practical: asking for the picture here draws and caches it, so when
 * LinkedIn's crawler arrives a few seconds later it is served instantly
 * instead of timing out on a cold render.
 */

interface Platform {
  name: string;
  href: (url: string, text: string) => string;
  /** Brand glyph, 24x24. The secondary platforms go without. */
  icon?: string;
}

const enc = encodeURIComponent;

const PRIMARY: Platform[] = [
  {
    name: "LinkedIn",
    href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    icon: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  {
    name: "Facebook",
    href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    icon: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  },
  {
    name: "X",
    href: (url, text) => `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
    icon: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
];

const SECONDARY: Platform[] = [
  { name: "Reddit", href: (url, text) => `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}` },
  { name: "Bluesky", href: (url, text) => `https://bsky.app/intent/compose?text=${enc(`${text} ${url}`)}` },
  { name: "Threads", href: (url, text) => `https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}` },
  { name: "WhatsApp", href: (url, text) => `https://wa.me/?text=${enc(`${text} ${url}`)}` },
  { name: "Telegram", href: (url, text) => `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
  { name: "Email", href: (url, text) => `mailto:?subject=${enc(text)}&body=${enc(url)}` },
];

export function ShareDialog({
  view,
  heading,
  text,
  onClose,
}: {
  view: ShareView;
  /** "Share this view", or the camera's name. */
  heading: string;
  /** The line a platform pre-fills alongside the link, where it takes one. */
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "failed">("loading");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const url = `${window.location.origin}/?${viewQuery(view)}`;
  const canNativeShare = typeof navigator.share === "function";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase and stopped here, so Escape closes this dialog only
      // and not the camera panel underneath it as well.
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be refused outright. Selecting the text
      // leaves the link one keypress from copied instead of failing
      // silently.
      inputRef.current?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: "World's Eye View", text, url });
    } catch {
      // Dismissing the share sheet rejects; that is not an error.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={heading}
        className="w-full max-w-md rounded-xl border border-wev-border bg-wev-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-wev-border px-4 py-3">
          <h2 className="min-w-0 truncate text-sm font-semibold text-wev-text">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-lg border border-wev-border bg-black">
            {previewState === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-wev-muted">
                Drawing the preview…
              </div>
            )}
            {previewState === "failed" ? (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-wev-muted">
                The preview couldn&apos;t be drawn just now. The link still works.
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- drawn by our own /api/og; next/image would only re-encode it
              <img
                src={previewImagePath(view)}
                alt="How this link will look when shared"
                className="h-full w-full object-cover"
                onLoad={() => setPreviewState("ready")}
                onError={() => setPreviewState("failed")}
              />
            )}
          </div>
          <p className="text-[11px] leading-snug text-wev-muted">
            This is the picture the link shows when posted. Opening it brings people to exactly this view.
          </p>

          <div className="flex gap-2">
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Link to share"
              className="min-w-0 flex-1 rounded-md border border-wev-border bg-wev-bg px-2.5 py-1.5 font-mono text-[11px] text-wev-text outline-none focus:border-sky-700"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md border border-sky-700/70 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-wev-accent transition-colors hover:bg-sky-500/20"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PRIMARY.map((platform) => (
              <a
                key={platform.name}
                href={platform.href(url, text)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md border border-wev-border bg-wev-panel-2 px-2 py-2 text-xs font-medium text-wev-text transition-colors hover:border-sky-700 hover:text-wev-accent"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
                  <path d={platform.icon} />
                </svg>
                {platform.name}
              </a>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {SECONDARY.map((platform) => (
              <a
                key={platform.name}
                href={platform.href(url, text)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-wev-muted transition-colors hover:text-wev-accent"
              >
                {platform.name}
              </a>
            ))}
            {canNativeShare && (
              <button type="button" onClick={nativeShare} className="text-wev-muted transition-colors hover:text-wev-accent">
                More…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
