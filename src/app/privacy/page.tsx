import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What World's Eye View stores, why, and how to delete it. Signing in is optional and exists only to save camera walls.",
};

/**
 * Deliberately short and specific. A privacy page that lists every
 * hypothetical thing a website might do is useless to a reader; this one
 * says what this app actually stores, which is very little.
 */
export default function PrivacyPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link href="/" className="text-xs text-wev-accent hover:underline">
          &larr; Back to the map
        </Link>

        <h1 className="mt-6 text-2xl font-semibold text-wev-text">Privacy</h1>
        <p className="mt-2 text-sm text-wev-muted">
          Last updated 14 August 2026.
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-wev-muted">
          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">You don&rsquo;t need an account</h2>
            <p>
              The map, the cameras and the multicam wall all work without signing in. Nothing on this site is behind a
              login. Signing in does exactly one thing: it lets you save more than one camera wall and get them back on
              another device.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">If you do sign in</h2>
            <p>Signing in with Google stores:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your email address, name and profile picture URL, as Google provides them</li>
              <li>An identifier linking your account to Google, so you can sign in again</li>
              <li>A session token, so you stay signed in</li>
              <li>The camera walls you save — their names, the cameras on them and their order</li>
            </ul>
            <p className="mt-2">
              That is the complete list. The permission requested from Google is the minimum one
              (<code className="text-wev-text">openid email profile</code>) — no access to your Drive, contacts,
              calendar or anything else, and nothing is requested for offline use.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">What isn&rsquo;t collected</h2>
            <p>
              No analytics, no advertising, no tracking pixels, no third-party scripts. Your location is never
              requested — the map opens on a fixed view, and where you pan is not recorded. Camera images are fetched
              by the server and passed to you, so the agencies operating those cameras never see your browser or
              address.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">Deleting it</h2>
            <p>
              Open the account menu and choose <strong className="text-wev-text">Delete account</strong>. It removes
              your user record, your saved walls and your sessions immediately and permanently. There is no soft
              delete, no retention window and no backup copy kept for later — once it&rsquo;s gone it cannot be
              recovered, including by us.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">Where it lives</h2>
            <p>
              On a Postgres database hosted by Railway, reachable only from this application over a private network.
              It is not shared with, sold to, or accessible by anyone else.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">The cameras</h2>
            <p>
              Every camera shown is published publicly by the agency operating it — transport departments, a volcano
              observatory, a city transport authority. World&rsquo;s Eye View does not operate any camera, and nothing
              here is private or obtained from a closed system.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-wev-text">Contact</h2>
            <p>
              World&rsquo;s Eye View is built by{" "}
              <a
                href="https://corticorp.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-wev-accent hover:underline"
              >
                CortiCorp
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
