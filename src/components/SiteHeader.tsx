"use client";

import { useState } from "react";
import Link from "next/link";
import { EyeGlobeMark, Wordmark } from "./Wordmark";
import { AboutPanel } from "./AboutPanel";

/**
 * Deliberately slim. The map is the product, so the chrome is one 48px
 * bar: the mark, the wordmark, and the two things anyone actually needs
 * (what this is, and where it came from).
 */
export function SiteHeader() {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <header className="z-[1500] flex h-12 shrink-0 items-center justify-between border-b border-wev-border bg-wev-panel px-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-wev-accent" aria-label="World's Eye View home">
          <EyeGlobeMark className="h-[22px] w-[22px]" />
          <Wordmark />
        </Link>

        <nav className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="rounded px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            About
          </button>
          <a
            href="https://corticorp.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2.5 py-1.5 text-xs text-wev-muted transition-colors hover:bg-wev-panel-2 hover:text-wev-text"
          >
            CortiCorp
          </a>
        </nav>
      </header>

      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </>
  );
}
