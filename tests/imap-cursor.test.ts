import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ uidValidity: 42n, uidNext: 1, records: [] as Array<{ uid: number; size: number; source: Buffer }>, bodyReads: [] as number[], ranges: [] as string[], logout: 0 }));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {}
    async mailboxOpen(_mailbox: string, options: { readOnly: boolean }) {
      if (!options.readOnly) throw new Error("Mailbox must be read-only");
      return { uidValidity: state.uidValidity, uidNext: state.uidNext };
    }
    async *fetch(range: string) {
      state.ranges.push(range);
      for (const record of state.records) yield { uid: record.uid, headers: record.source.subarray(0, record.source.indexOf("\r\n\r\n") + 2) };
    }
    async fetchOne(uid: string) { state.bodyReads.push(Number(uid)); return state.records.find((record) => record.uid === Number(uid)) ?? false; }
    async logout() { state.logout += 1; }
  }
}));

import { fetchRecentMail, mailboxCursorKey, MAX_MESSAGE_BYTES, type ImapConfig } from "@/src/ingest/imap";
const config: ImapConfig = { host: "imap.example.com", port: 993, user: "reader@example.com", password: "test", mailbox: "INBOX", sinceDays: 0 };
const source = Buffer.from("From: test@itau.com.uy\r\nSubject: Aviso de consumo\r\nMessage-ID: <example@example.com>\r\n\r\nHello");

beforeEach(() => { state.uidValidity = 42n; state.uidNext = 1; state.records = []; state.bodyReads = []; state.ranges = []; state.logout = 0; });

describe("IMAP cursor batches", () => {
  it("starts at UID 1, reads a bounded window and resumes after the last window", async () => {
    state.uidNext = 1201;
    state.records = [{ uid: 1, size: source.length, source }];
    const first = await fetchRecentMail(config, null);
    expect(state.ranges).toEqual(["1:500"]);
    expect(first.cursor).toEqual({ uidValidity: "42", lastUid: 500 });
    expect(first.messages[0].messageId).toBe("<example@example.com>");
    state.records = [];
    const second = await fetchRecentMail(config, first.cursor);
    expect(state.ranges[1]).toBe("501:1000");
    expect(second.cursor.lastUid).toBe(1000);
  });

  it("restarts at UID 1 when UIDVALIDITY changes, and handles an empty mailbox", async () => {
    state.uidValidity = 43n;
    const empty = await fetchRecentMail(config, { uidValidity: "42", lastUid: 50 });
    expect(empty.cursor).toEqual({ uidValidity: "43", lastUid: 0 });
    expect(state.ranges).toEqual([]);
    state.uidNext = 10;
    await fetchRecentMail(config, { uidValidity: "42", lastUid: 50 });
    expect(state.ranges).toEqual(["1:9"]);
  });

  it("fails the batch on excessive or incomplete source without returning a cursor", async () => {
    state.uidNext = 2;
    state.records = [{ uid: 1, size: MAX_MESSAGE_BYTES + 1, source }];
    await expect(fetchRecentMail(config, null)).rejects.toThrow("size limit");
    state.records = [{ uid: 1, size: source.length + 1, source }];
    await expect(fetchRecentMail(config, null)).rejects.toThrow("incomplete");
    expect(state.logout).toBe(2);
  });

  it("does not retrieve bodies of unrelated messages, even when large", async () => {
    state.uidNext = 2;
    const unrelated = Buffer.from("From: stranger@example.test\r\nSubject: Other\r\n\r\nPrivate body");
    state.records = [{ uid: 1, size: MAX_MESSAGE_BYTES + 1, source: unrelated }];
    const batch = await fetchRecentMail(config, null);
    expect(batch.messages).toEqual([]);
    expect(state.bodyReads).toEqual([]);
    expect(batch.cursor.lastUid).toBe(1);
  });

  it("keys the cursor by mailbox identity but not its password", () => {
    expect(mailboxCursorKey(config)).toBe(mailboxCursorKey({ ...config, password: "changed" }));
    expect(mailboxCursorKey(config)).not.toBe(mailboxCursorKey({ ...config, mailbox: "other" }));
  });
});
