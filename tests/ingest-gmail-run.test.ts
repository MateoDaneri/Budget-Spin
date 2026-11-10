import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/src/db/client";
import { migrate } from "@/src/db/repository";
import { runItauIngest } from "@/src/ingest/ingest-itau";

const state = vi.hoisted(() => ({ failure: null as unknown }));
vi.mock("@/src/ingest/gmail", () => ({ syncGmail: async () => { throw state.failure; } }));

let db: string;
beforeEach(() => { db = path.join(os.tmpdir(), `gmail-run-${crypto.randomUUID()}.sqlite`); process.env.DATABASE_PATH = db; process.env.ITAU_INGEST_PROVIDER = "gmail"; closeDb(); migrate(); });
afterEach(() => { closeDb(); for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(db + suffix, { force: true }); delete process.env.DATABASE_PATH; delete process.env.ITAU_INGEST_PROVIDER; });

function lastError(): unknown {
  return (getDb().prepare("SELECT error FROM ingest_runs ORDER BY id DESC LIMIT 1").get() as { error: unknown }).error;
}

it("records a fixed description, not the provider error text, when the Gmail pass fails", async () => {
  state.failure = Object.assign(new Error("private provider detail"), { status: 403 });
  await expect(runItauIngest()).rejects.toThrow("private provider detail");
  expect(lastError()).toBe("Gmail synchronization failed (HTTP 403).");
  state.failure = new Error("another private detail");
  await expect(runItauIngest()).rejects.toThrow();
  expect(lastError()).toBe("Gmail synchronization failed.");
});
