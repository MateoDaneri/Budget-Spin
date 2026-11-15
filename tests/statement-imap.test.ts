import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  records: [] as Array<{ uid: number; size: number; source: Buffer }>,
  uidNext: 1,
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {}
    async logout() {}
    async mailboxOpen(_name: string, opts: { readOnly: boolean }) {
      if (!opts.readOnly) throw Error();
      return { uidValidity: 42n, uidNext: state.uidNext };
    }
    async *fetch() {
      for (const m of state.records)
        yield {
          uid: m.uid,
          headers: m.source.subarray(0, m.source.indexOf("\r\n\r\n") + 2),
        };
    }
    async fetchOne(id: string) {
      return state.records.find((m) => m.uid === Number(id)) ?? false;
    }
  },
}));
import {
  fetchStatementBatch,
  MAX_STATEMENT_MESSAGE_BYTES,
} from "@/src/ingest/statement-imap";
import type { ImapConfig } from "@/src/ingest/imap";
const cfg: ImapConfig = {
  host: "imap.example.test",
  port: 993,
  user: "x@example.test",
  password: "x",
  mailbox: "INBOX",
  sinceDays: 0,
};
const message = (uid: number, from = "bank@itau.com.uy") =>
  Buffer.from(
    `From: ${from}\r\nSubject: Envio de estado de cuenta Visa Itau\r\nMessage-ID: <${uid}@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=abc\r\n\r\n--abc\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n--abc--\r\n`,
  );
beforeEach(() => {
  state.records = [];
  state.uidNext = 1;
});
describe("statement attachments", () => {
  it("bounds each batch and does not advance past unprocessed candidates", async () => {
    state.uidNext = 7;
    state.records = Array.from({ length: 6 }, (_, i) => {
      const uid = i + 1,
        source = message(uid);
      return { uid, source, size: source.length };
    });
    const batch = await fetchStatementBatch(cfg, null);
    expect(batch.messages).toHaveLength(5);
    expect(batch.cursor.lastUid).toBe(5);
    expect(batch.hasMore).toBe(true);
  });
  it("checks a large header window without skipping the checkpoint", async () => {
    state.uidNext = 12001;
    const batch = await fetchStatementBatch(cfg, null);
    expect(batch.cursor.lastUid).toBe(5000);
    expect(batch.hasMore).toBe(true);
  });
  it("quarantines oversized and malformed attachments while preserving unrelated mail", async () => {
    state.uidNext = 4;
    const a = message(1),
      b = message(2),
      unrelated = message(3, "other@example.test");
    state.records = [
      { uid: 1, source: a, size: MAX_STATEMENT_MESSAGE_BYTES + 1 },
      { uid: 2, source: b, size: b.length + 1 },
      { uid: 3, source: unrelated, size: unrelated.length },
    ];
    const batch = await fetchStatementBatch(cfg, null);
    expect(batch.rejected).toEqual([1, 2]);
    expect(batch.messages).toHaveLength(0);
    expect(batch.cursor.lastUid).toBe(3);
  });
});
