import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { decideAccess, isApiPath, TOKEN_AUTHENTICATED_ROUTES } from "@/src/auth/access-policy";
import { config, proxy } from "@/proxy";

describe("decideAccess", () => {
  it("lets the token-authenticated ingest routes through without a session", () => {
    expect([...TOKEN_AUTHENTICATED_ROUTES].sort()).toEqual(["/api/ingest/itau", "/api/ingest/splitwise"]);
    expect(decideAccess("/api/ingest/itau", false)).toBe("allow");
    expect(decideAccess("/api/ingest/splitwise", false)).toBe("allow");
  });

  it("answers 401 for any other API path without a session", () => {
    for (const path of [
      "/api",
      "/api/fx-rate",
      "/api/ingest",
      "/api/ingest/",
      "/api/ingest/itau/",
      "/api/ingest/itau-foo",
      "/api/ingest/itau/extra",
      "/api/ingest/other",
      "/api/future-route"
    ]) {
      expect(decideAccess(path, false), path).toBe("unauthorized");
    }
    // Paths are case-sensitive: an upper-case look-alike is not an API route and
    // is denied like any other page (login redirect), never allowed.
    expect(decideAccess("/API/ingest/itau", false)).toBe("redirect-login");
  });

  it("treats look-alike prefixes as pages, never as a bypass", () => {
    expect(isApiPath("/apiX")).toBe(false);
    expect(isApiPath("/api-docs")).toBe(false);
    expect(decideAccess("/apiX", false)).toBe("redirect-login");
    expect(decideAccess("/api-docs", false)).toBe("redirect-login");
  });

  it("redirects page requests without a session to login", () => {
    expect(decideAccess("/", false)).toBe("redirect-login");
    expect(decideAccess("/expenses", false)).toBe("redirect-login");
  });

  it("handles the login page both ways", () => {
    expect(decideAccess("/login", false)).toBe("allow");
    expect(decideAccess("/login", true)).toBe("redirect-home");
  });

  it("allows pages and API routes with a session", () => {
    expect(decideAccess("/expenses", true)).toBe("allow");
    expect(decideAccess("/api/fx-rate", true)).toBe("allow");
  });
});

describe("proxy", () => {
  it("no longer excludes /api from the matcher", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
    expect(config.matcher.join("")).not.toContain("api");
  });

  it("answers an unauthenticated API request with 401 JSON, not a redirect", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/fx-rate?base=USD&quote=UYU"));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Unauthorized." });
  });

  it("rejects a forged session cookie on API routes", async () => {
    const request = new NextRequest("http://localhost/api/fx-rate", {
      headers: { cookie: `budgetspin_session=user.${Date.now() + 60_000}.forged` }
    });
    expect((await proxy(request)).status).toBe(401);
  });

  it("still redirects an unauthenticated page request to login", async () => {
    const response = await proxy(new NextRequest("http://localhost/expenses?sort=amount"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/expenses?sort=amount");
  });

  it("passes the ingest routes through to their own bearer-token check", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/ingest/itau", { method: "POST" }));
    expect(response.status).not.toBe(401);
    expect(response.headers.get("location")).toBeNull();
  });
});
