import crypto from "node:crypto";
import { triggerToken } from "@/src/ingest/trigger-token";
import { NextResponse } from "next/server";
import { runItauIngest } from "@/src/ingest/ingest-itau";

// Triggered by the cron sidecar (POST with a bearer token). The token is a
// dedicated ingest secret, separate from the session secret: if it leaks, an
// attacker can only trigger an ingest pass — never read the app or the bank.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This guards a single Node process. Multiple app replicas need a shared lock.
let ingestRunning = false;

export async function POST(request: Request) {
  let token: string | undefined;
  try { token = await triggerToken(); } catch { return NextResponse.json({ error: "Ingest is not configured." }, { status: 503 }); }
  if (!token) {
    return NextResponse.json({ error: "Ingest is not configured." }, { status: 503 });
  }

  if (!isAuthorized(request, token)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (ingestRunning) {
    return NextResponse.json({ error: "Ingest already running." }, { status: 409 });
  }
  ingestRunning = true;

  try {
    const summary = await runItauIngest();
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    return NextResponse.json({ ok: false, error: "Ingest failed." }, { status: 500 });
  } finally {
    ingestRunning = false;
  }
}

function isAuthorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }

  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  // Length check first: timingSafeEqual throws on length mismatch.
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
