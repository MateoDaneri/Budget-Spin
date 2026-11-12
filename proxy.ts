import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, LOGIN_PATH } from "@/src/auth/access-policy";

const AUTH_COOKIE_NAME = "budgetspin_session";
const AUTH_USER_ID = "mdaneri";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = session ? await verifySession(session) : false;

  switch (decideAccess(pathname, isAuthenticated)) {
    case "allow":
      return NextResponse.next();
    case "redirect-home":
      return NextResponse.redirect(new URL("/", request.url));
    case "unauthorized":
      // API clients (fetch, schedulers) get JSON they can handle, not a
      // redirect to an HTML login page.
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    case "redirect-login": {
      const loginUrl = new URL(LOGIN_PATH, request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
  }
}

// Only build output and the favicon skip the proxy. `/api` is no longer
// excluded: every API route goes through decideAccess, which lets through only
// the exact token-authenticated ingest paths (src/auth/access-policy.ts).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

async function verifySession(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [userId, expiresAtRaw, providedSignature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (userId !== AUTH_USER_ID || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const expected = await signature(`${userId}.${expiresAtRaw}`);
  return expected === providedSignature;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(digest);
}

function base64UrlEncode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function authSecret() {
  return process.env.BUDGETSPIN_AUTH_SECRET ?? "budgetspin-local-dev-secret";
}
