/**
 * Warms the camera catalogue at boot so the first real visitor doesn't
 * pay for it.
 *
 * Building the catalogue means fetching every upstream feed — roughly 40
 * seconds. Without this, whoever loads the map first after a deploy sits
 * on a spinner for the whole of it.
 *
 * Deliberately NOT awaited. Next calls `register()` once at startup and
 * waits for it to resolve *before the server accepts any requests*, so
 * awaiting the warm-up here would make the process unreachable for 40
 * seconds — long enough for a platform healthcheck to declare the deploy
 * dead and roll it back. Kicking it off and returning immediately means
 * the server is up right away and the catalogue fills in behind it; a
 * request that lands mid-warm simply joins the in-flight fetch, because
 * the registry already de-duplicates concurrent loads.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { getCatalog } = await import("./lib/cams/registry");

  const startedAt = Date.now();
  void getCatalog()
    .then((catalog) => {
      console.log(`[cams] warm-up complete: ${catalog.cams.length} cameras in ${Date.now() - startedAt}ms`);
    })
    .catch((error) => {
      // A failed warm-up is survivable: the next request retries, and any
      // source that did load is already cached.
      console.warn("[cams] warm-up failed:", error);
    });
}
