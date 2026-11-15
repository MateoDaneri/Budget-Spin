import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import {
  getIngestCursor,
  listCardStatements,
  listTransactions,
  saveIngestCursor,
} from "@/src/db/repository";
import { mailboxCursorKey, type ImapConfig } from "@/src/ingest/imap";
import { statementCursorKey } from "@/src/ingest/statement-imap";
import { runStatementIngest } from "@/src/ingest/ingest-statement";
const cfg: ImapConfig = {
  host: "imap.example.test",
  port: 993,
  user: "synthetic@example.test",
  password: "synthetic",
  mailbox: "INBOX",
  sinceDays: 0,
};
const summary = {
  issuedOn: "2026-01-01",
  dueDate: "2026-01-10",
  totalUyuMinor: 1234,
  totalUsdMinor: 0,
};
let db: string;
beforeEach(() => {
  db = path.join(os.tmpdir(), `statement-ingest-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = db;
  process.env.ITAU_IMAP_STATE_DIR = `${db}-state`;
  closeDb();
});
afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"])
    fs.rmSync(db + suffix, { force: true });
  fs.rmSync(`${db}-state`, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.ITAU_IMAP_STATE_DIR;
});
const mail = (uid: number) => ({
  uid,
  messageId: `<${uid}@example.test>`,
  pdf: Buffer.from("%PDF-synthetic"),
});
describe("statement historical ingestion", () => {
  it("preserves the purchase cursor, quarantines failures and resumes idempotently", async () => {
    const purchaseKey = mailboxCursorKey(cfg),
      statementKey = statementCursorKey(purchaseKey);
    saveIngestCursor(purchaseKey, "42", 9999);
    const fetcher = async () => ({
      messages: [mail(1), mail(2)],
      rejected: [3],
      cursor: { uidValidity: "42", lastUid: 50 },
      hasMore: false,
    });
    const result = await runStatementIngest(cfg, {
      fetcher,
      parse: async (pdf) => {
        if (pdf === undefined) throw Error();
        return summary;
      },
    });
    expect(result).toEqual({ inserted: 2, quarantined: 1 });
    expect(getIngestCursor(purchaseKey)).toEqual({
      uidValidity: "42",
      lastUid: 9999,
    });
    expect(getIngestCursor(statementKey)?.lastUid).toBe(50);
    expect(listCardStatements()).toHaveLength(1);
    expect(listTransactions()).toHaveLength(0);
    const second = await runStatementIngest(cfg, {
      fetcher,
      retry: async () => [],
      parse: async () => summary,
    });
    expect(second.inserted).toBe(0);
    expect(second.quarantined).toBe(1);
  });
  it("retains unreadable PDFs without storing their content and continues", async () => {
    const result = await runStatementIngest(cfg, {
      fetcher: async () => ({
        messages: [mail(1), mail(2)],
        rejected: [],
        cursor: { uidValidity: "42", lastUid: 2 },
        hasMore: false,
      }),
      parse: async (pdf) => {
        if (pdf.length) throw Error("private PDF content");
        return summary;
      },
    });
    expect(result).toEqual({ inserted: 0, quarantined: 2 });
    expect(listCardStatements()).toEqual([]);
  });
});
