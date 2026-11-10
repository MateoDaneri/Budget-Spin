/* eslint-disable security/detect-non-literal-fs-filename -- Test-only temporary files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import { getIngestCursor, listTransactions, migrate } from "@/src/db/repository";
import { runItauIngest } from "@/src/ingest/ingest-itau";
import { mailboxCursorKey, readImapConfigFromEnv } from "@/src/ingest/imap";
import type { ItauEmailInput } from "@/src/ingest/itau-parser";

const html = fs.readFileSync(path.resolve(__dirname, "fixtures/itau-aviso-consumo.html"), "utf8");

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `budgetspin-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  process.env.ITAU_IMAP_STATE_DIR = `${dbPath}-state`;
  process.env.ITAU_IMAP_HOST = "imap.example.com";
  process.env.ITAU_IMAP_USER = "ingest@example.com";
  process.env.ITAU_IMAP_PASSWORD = "test-token";
  closeDb();
  migrate();
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.rmSync(`${dbPath}-state`, { recursive: true, force: true });
  delete process.env.ITAU_IMAP_STATE_DIR;
  delete process.env.DATABASE_PATH;
  delete process.env.ITAU_IMAP_HOST;
  delete process.env.ITAU_IMAP_USER;
  delete process.env.ITAU_IMAP_PASSWORD;
});

function aviso(overrides: Partial<ItauEmailInput> = {}): ItauEmailInput {
  return {
    subject: "Aviso de consumo aprobado con tarjeta de crédito",
    from: "comunicaciones@itau.com.uy",
    date: new Date("2026-06-22T20:04:29.000Z"),
    messageId: "<msg-1@email.amazonses.com>",
    html,
    ...overrides
  };
}

function batch(messages: ItauEmailInput[]) {
  return { messages, cursor: { uidValidity: "42", lastUid: 50 }, hasMore: false };
}

describe("runItauIngest", () => {
  it("parses, converts and inserts an aviso end to end", async () => {
    const summary = await runItauIngest({ fetcher: async () => batch([aviso()]) });

    expect(summary).toEqual({ messagesSeen: 1, inserted: 1, skipped: 0 });
    const rows = listTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountMinor: 19900, currencyCode: "UYU", status: "pending" });
  });

  it("skips non-aviso mail without crashing the run", async () => {
    const newsletter = aviso({ subject: "Novedades de Itaú", messageId: "<msg-2@x>" });
    const summary = await runItauIngest({ fetcher: async () => batch([newsletter]) });

    expect(summary).toEqual({ messagesSeen: 1, inserted: 0, skipped: 1 });
    expect(listTransactions()).toHaveLength(0);
  });

  it("is idempotent across runs (same Message-ID)", async () => {
    await runItauIngest({ fetcher: async () => batch([aviso()]) });
    const second = await runItauIngest({ fetcher: async () => batch([aviso()]) });

    expect(second).toEqual({ messagesSeen: 1, inserted: 0, skipped: 1 });
    expect(listTransactions()).toHaveLength(1);
  });

  it("imports debit notices idempotently without merging distinct notices with equal amounts", async () => {
    const debit = aviso({ subject: "Aviso de consumo aprobado con tarjeta de débito", html: fs.readFileSync(path.resolve(__dirname, "fixtures/itau-debit-synthetic.html"), "utf8") });
    const first = await runItauIngest({ fetcher: async () => batch([debit]) });
    const retry = await runItauIngest({ fetcher: async () => batch([debit, { ...debit, messageId: "<another-synthetic@example.com>" }]) });
    expect(first.inserted).toBe(1);
    expect(retry).toMatchObject({ inserted: 1, skipped: 1 });
    const rows = listTransactions();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "purchase" && row.currencyCode === "UYU" && row.amountMinor === 123456 && row.status === "pending")).toBe(true);
  });

  it("retries a partially processed batch without advancing its cursor or duplicating the first message", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const malformed = { ...aviso(), subject: null } as unknown as ItauEmailInput;
    await expect(runItauIngest({ fetcher: async () => batch([aviso(), malformed]) })).rejects.toThrow();
    expect(getIngestCursor(key)).toBeNull();
    expect(listTransactions()).toHaveLength(1);
    let previous: unknown = "not called";
    const result = await runItauIngest({ fetcher: async (_config, cursor) => {
      previous = cursor;
      return batch([aviso(), aviso({ messageId: "<second@example.com>" })]);
    } });
    expect(previous).toBeNull();
    expect(result).toMatchObject({ inserted: 1, skipped: 1 });
    expect(getIngestCursor(key)).toEqual({ uidValidity: "42", lastUid: 50 });
    expect(listTransactions()).toHaveLength(2);
  });

  it("stops on an unparseable candidate without advancing, then recovers after correction", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    await expect(runItauIngest({ fetcher: async () => batch([aviso({ html: "unknown format" })]) })).rejects.toThrow("could not be parsed");
    expect(getIngestCursor(key)).toBeNull();
    await runItauIngest({ fetcher: async () => batch([aviso()]) });
    expect(listTransactions()).toHaveLength(1);
    expect(getIngestCursor(key)?.lastUid).toBe(50);
  });

  it("quarantines an unknown notice before advancing and imports later notices", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const result = await runItauIngest({ fetcher: async () => batch([
      aviso({ uid: 1, html: "unknown secret body" }),
      aviso({ uid: 2, messageId: "<later@example.test>" })
    ]) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(getIngestCursor(key)?.lastUid).toBe(50);
    const stored = fs.readFileSync(path.join(process.env.ITAU_IMAP_STATE_DIR!, `imap-quarantine-${key}.json`), "utf8");
    expect(JSON.parse(stored)).toEqual([{ uidValidity: "42", uid: 1 }]);
    expect(stored).not.toContain("unknown secret body");
  });

  it("retains zero-value notices for review without creating a transaction", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const zero = aviso({ uid: 1, html: html.replace("199.0", "0.0") });
    const result = await runItauIngest({ fetcher: async () => batch([zero, aviso({ uid: 2, messageId: "<positive@example.test>" })]) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(listTransactions()).toHaveLength(1);
    const stored = JSON.parse(fs.readFileSync(path.join(process.env.ITAU_IMAP_STATE_DIR!, `imap-quarantine-${key}.json`), "utf8"));
    expect(stored).toEqual([{ uidValidity: "42", uid: 1 }]);
  });

  it("retries retained notices without losing missing messages", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    await runItauIngest({ fetcher: async () => batch([aviso({ uid: 1, html: "unknown" }), aviso({ uid: 2, html: "unknown" })]) });
    const result = await runItauIngest({
      fetcher: async () => batch([]),
      retryFetcher: async (_config, validity, ids) => {
        expect(validity).toBe("42"); expect(ids).toEqual([1, 2]);
        return [aviso({ uid: 1 })];
      }
    });
    expect(result.inserted).toBe(1);
    const stored = JSON.parse(fs.readFileSync(path.join(process.env.ITAU_IMAP_STATE_DIR!, `imap-quarantine-${key}.json`), "utf8"));
    expect(stored).toEqual([{ uidValidity: "42", uid: 2 }]);
  });

  it("catches up at most ten windows and passes each committed checkpoint to the next fetch", async () => {
    const previousValues: number[] = [];
    await runItauIngest({ fetcher: async (_config, previous) => {
      previousValues.push(previous?.lastUid ?? 0);
      return { messages: [], cursor: { uidValidity: "42", lastUid: (previous?.lastUid ?? 0) + 50 }, hasMore: true };
    } });
    expect(previousValues).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400, 450]);
    expect(getIngestCursor(mailboxCursorKey(readImapConfigFromEnv()!))?.lastUid).toBe(500);
  });

  it("records an error run and rethrows when the fetcher fails", async () => {
    await expect(
      runItauIngest({
        fetcher: async () => {
          throw new Error("IMAP down");
        }
      })
    ).rejects.toThrow("IMAP down");
  });
});
