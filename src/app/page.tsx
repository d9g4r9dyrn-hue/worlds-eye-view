import { WorldsEyeViewClient } from "@/components/WorldsEyeViewClient";

/**
 * The map is the entire site, so it's the root route and it fills
 * everything the header doesn't. The page itself is a static shell —
 * cameras load client-side from /api/cams — which is what keeps this
 * prerenderable despite the content changing every couple of minutes.
 */
export default function HomePage() {
  return (
    <div className="h-full w-full">
      <WorldsEyeViewClient />
    </div>
  );
}
