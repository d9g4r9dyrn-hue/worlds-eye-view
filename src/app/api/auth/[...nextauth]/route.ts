import { NextResponse, type NextRequest } from "next/server";
import { handlers, authEnabled } from "@/auth";

/**
 * Auth.js callback and session endpoints.
 *
 * Short-circuited when sign-in isn't configured. Auth.js requires at
 * least one provider and returns HTTP 500 ("There was a problem with the
 * server configuration") without one — which meant that before Google
 * credentials were added, every page load produced a pair of 500s in the
 * console from the client's routine session poll. The map worked, but it
 * looked broken to anyone with devtools open.
 *
 * So when disabled these answer the way a signed-out site legitimately
 * should: no session, no providers, no error.
 */

function disabledResponse(pathname: string): NextResponse {
  if (pathname.endsWith("/session")) return NextResponse.json(null);
  if (pathname.endsWith("/providers")) return NextResponse.json({});
  if (pathname.endsWith("/csrf")) return NextResponse.json({ csrfToken: "" });
  return NextResponse.json({});
}

export async function GET(request: NextRequest) {
  if (!authEnabled) return disabledResponse(new URL(request.url).pathname);
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  if (!authEnabled) return disabledResponse(new URL(request.url).pathname);
  return handlers.POST(request);
}
