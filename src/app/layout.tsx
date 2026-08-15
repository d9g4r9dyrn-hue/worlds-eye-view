import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const DESCRIPTION =
  "Thousands of public webcams quilted onto one satellite map. Volcanoes, harbours, city streets and highways, updating live — zoom in and the world fills with windows.";

export const metadata: Metadata = {
  metadataBase: new URL("https://cams.corticorp.com"),
  title: { default: "World's Eye View", template: "%s · World's Eye View" },
  description: DESCRIPTION,
  applicationName: "World's Eye View",
  openGraph: {
    type: "website",
    siteName: "World's Eye View",
    title: "World's Eye View",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "World's Eye View", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

/**
 * Next supplies a sensible default viewport; this states it explicitly to
 * add two things it doesn't.
 *
 * `viewportFit: "cover"` lets the map run under a phone's rounded corners
 * and notch instead of being letterboxed by them, which matters when the
 * whole page is one edge-to-edge map.
 *
 * Deliberately NOT setting `maximumScale`/`userScalable: false`. Locking
 * zoom would mask the iOS input-focus zoom (see globals.css) rather than
 * fix it, and would take pinch-zoom away from anyone who needs it to read
 * a camera label.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06080b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      {/* No theme provider and no light mode: every pixel below the header
          is satellite imagery or a camera frame, and light chrome around
          that reads as a rendering bug rather than a preference. */}
      <body className="flex h-full flex-col overflow-hidden">
        <SiteHeader />
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
