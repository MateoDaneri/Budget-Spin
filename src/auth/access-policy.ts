// Pure access decision used by proxy.ts. Kept free of Next.js imports so it can
// be unit-tested and reviewed on its own.
//
// Default is closed: every path the proxy sees needs a session, except the
// login page and the routes listed below, which authenticate themselves.

/**
 * Routes called by schedulers without a browser session. Each one checks a
 * bearer token itself (src/ingest/trigger-token.ts). Compared by exact
 * pathname: no prefixes, no patterns, so `/api/ingest/itau-foo` or a future
 * `/api/ingest/*` route does not inherit the bypass.
 */
export const TOKEN_AUTHENTICATED_ROUTES: ReadonlySet<string> = new Set([
  "/api/ingest/itau",
  "/api/ingest/splitwise"
]);

export const LOGIN_PATH = "/login";

export type AccessDecision =
  /** Let the request through. */
  | "allow"
  /** Already signed in and asking for /login: send to the home page. */
  | "redirect-home"
  /** Page request without a session: send to /login. */
  | "redirect-login"
  /** API request without a session: answer 401 JSON, never an HTML redirect. */
  | "unauthorized";

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideAccess(pathname: string, isAuthenticated: boolean): AccessDecision {
  if (TOKEN_AUTHENTICATED_ROUTES.has(pathname)) {
    return "allow";
  }

  if (pathname === LOGIN_PATH) {
    return isAuthenticated ? "redirect-home" : "allow";
  }

  if (isAuthenticated) {
    return "allow";
  }

  return isApiPath(pathname) ? "unauthorized" : "redirect-login";
}
