import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Providers } from "@/components/Providers";
import { authEnabled } from "@/auth";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      {/* No theme provider and no light mode: every pixel below the header
          is satellite imagery or a camera frame, and light chrome around
          that reads as a rendering bug rather than a preference. */}
      <body className="flex h-full flex-col overflow-hidden">
        <Providers>
          <SiteHeader authEnabled={authEnabled} />
          <main className="min-h-0 flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
