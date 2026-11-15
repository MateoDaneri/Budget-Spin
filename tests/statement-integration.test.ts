import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  statement: vi.fn(async () => ({ inserted: 0, quarantined: 0 })),
}));
vi.mock("@/src/ingest/ingest-statement", () => ({
  runStatementIngest: fake.statement,
}));
vi.mock("@/src/ingest/imap", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/ingest/imap")>();
  return {
    ...original,
    fetchRecentMail: async () => ({
      messages: [],
      cursor: { uidValidity: "42", lastUid: 0 },
      hasMore: false,
    }),
  };
});
import { closeDb } from "@/src/db/client";
import { runItauIngest } from "@/src/ingest/ingest-itau";
let db: string;
beforeEach(() => {
  db = path.join(
    os.tmpdir(),
    `statement-scheduler-${crypto.randomUUID()}.sqlite`,
  );
  process.env.DATABASE_PATH = db;
  process.env.ITAU_IMAP_STATE_DIR = `${db}-state`;
  process.env.ITAU_IMAP_HOST = "imap.example.test";
  process.env.ITAU_IMAP_USER = "x@example.test";
  process.env.ITAU_IMAP_PASSWORD = "synthetic";
  fake.statement.mockClear();
  closeDb();
});
afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"])
    fs.rmSync(db + suffix, { force: true });
  fs.rmSync(`${db}-state`, { recursive: true, force: true });
  for (const key of [
    "DATABASE_PATH",
    "ITAU_IMAP_STATE_DIR",
    "ITAU_IMAP_HOST",
    "ITAU_IMAP_USER",
    "ITAU_IMAP_PASSWORD",
  ])
    delete process.env[key];
});
it("runs independent statement scanning during the normal scheduled pass", async () => {
  await runItauIngest();
  expect(fake.statement).toHaveBeenCalledOnce();
});
