/* eslint-disable security/detect-non-literal-fs-filename -- Test-only temporary files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/src/db/client";
import { getIngestCursor, insertImportedTransaction, listCurrencies, listTransactions, migrate } from "@/src/db/repository";
import { calculateActualMonth } from "@/src/finance/actual-spending";
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
  delete process.env.ITAU_IMAP_AUTHSERV_ID;
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

function readQuarantine(key: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(process.env.ITAU_IMAP_STATE_DIR!, `imap-quarantine-${key}.json`), "utf8"));
}

function lastRun(): { status: unknown; error: unknown } {
  return getDb().prepare("SELECT status, error FROM ingest_runs ORDER BY id DESC LIMIT 1").get() as { status: unknown; error: unknown };
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

  it("quarantines an unparseable candidate, advances the cursor and imports later notices in the same pass", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const result = await runItauIngest({ fetcher: async () => batch([
      aviso({ uid: 1, html: "unknown format" }),
      aviso({ uid: 2, messageId: "<after-unparseable@example.test>" })
    ]) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(getIngestCursor(key)?.lastUid).toBe(50);
    expect(readQuarantine(key)).toEqual([{ uidValidity: "42", uid: 1, reason: "unrecognized" }]);
  });

  it("quarantines an unsupported amount format and continues with later notices", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const result = await runItauIngest({ fetcher: async () => batch([
      aviso({ uid: 1, messageId: "<bad-amount@example.test>", html: html.replace("199.0", "1.2.3") }),
      aviso({ uid: 2, messageId: "<bad-precision@example.test>", html: html.replace("199.0", "199.001") }),
      aviso({ uid: 3, messageId: "<after-amount@example.test>" })
    ]) });
    expect(result).toEqual({ messagesSeen: 3, inserted: 1, skipped: 2 });
    expect(getIngestCursor(key)?.lastUid).toBe(50);
    expect(listTransactions()).toHaveLength(1);
    expect(readQuarantine(key)).toEqual([
      { uidValidity: "42", uid: 1, reason: "invalid_amount" },
      { uidValidity: "42", uid: 2, reason: "unsupported_precision" }
    ]);
  });

  it("quarantines a notice in an unconfigured currency and continues with later notices", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const result = await runItauIngest({ fetcher: async () => batch([
      aviso({ uid: 1, messageId: "<unknown-currency@example.test>", html: html.replace(">UYU<", ">XYZ<") }),
      aviso({ uid: 2, messageId: "<after-currency@example.test>" })
    ]) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(getIngestCursor(key)?.lastUid).toBe(50);
    expect(readQuarantine(key)).toEqual([{ uidValidity: "42", uid: 1, reason: "unconfigured_currency" }]);
  });

  it("quarantines an oversized candidate reported by the fetcher and imports the rest of the window", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const result = await runItauIngest({ fetcher: async () => ({
      ...batch([aviso({ uid: 2, messageId: "<after-oversized@example.test>" })]),
      rejected: [{ uid: 1, reason: "oversized" as const }]
    }) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(getIngestCursor(key)?.lastUid).toBe(50);
    expect(readQuarantine(key)).toEqual([{ uidValidity: "42", uid: 1, reason: "oversized" }]);
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
    expect(JSON.parse(stored)).toEqual([{ uidValidity: "42", uid: 1, reason: "unrecognized" }]);
    expect(stored).not.toContain("unknown secret body");
    expect(lastRun()).toEqual({ status: "error", error: "Unrecognized notices retained for review." });
  });

  it("retains zero-value notices for review without creating a transaction", async () => {
    const key = mailboxCursorKey(readImapConfigFromEnv()!);
    const zero = aviso({ uid: 1, html: html.replace("199.0", "0.0") });
    const result = await runItauIngest({ fetcher: async () => batch([zero, aviso({ uid: 2, messageId: "<positive@example.test>" })]) });
    expect(result).toEqual({ messagesSeen: 2, inserted: 1, skipped: 1 });
    expect(listTransactions()).toHaveLength(1);
    expect(readQuarantine(key)).toEqual([{ uidValidity: "42", uid: 1, reason: "non_positive_amount" }]);
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
    expect(readQuarantine(key)).toEqual([{ uidValidity: "42", uid: 2, reason: "unrecognized" }]);
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

  it("records a fixed description, never the provider error text, when the pass fails", async () => {
    await expect(runItauIngest({ fetcher: async () => { throw new Error("private provider detail"); } })).rejects.toThrow("private provider detail");
    expect(lastRun()).toEqual({ status: "error", error: "IMAP synchronization failed." });
    await runItauIngest({ fetcher: async () => batch([aviso()]) });
    expect(lastRun()).toEqual({ status: "ok", error: null });
  });
});

describe("sender authentication (MEJ-002, observation mode)", () => {
  // Synthetic receiving-server identity; the bank domain matches the parser's sender check.
  const RECEIVER = "mx.receiver.example";
  const PASS = ` ${RECEIVER}; spf=pass smtp.mailfrom=itau.com.uy; dkim=pass (good signature) header.d=itau.com.uy; dmarc=pass header.from=itau.com.uy`;
  const FAIL = ` ${RECEIVER}; spf=fail smtp.mailfrom=itau.com.uy; dkim=none; dmarc=fail (p=REJECT) header.from=itau.com.uy`;

  function storedVerdicts(): Record<string, unknown> {
    const rows = getDb().prepare("SELECT message_id, sender_auth FROM transactions ORDER BY id").all() as Array<{ message_id: string; sender_auth: unknown }>;
    return Object.fromEntries(rows.map((row) => [row.message_id, row.sender_auth]));
  }

  it("stores pass, fail and none per imported notice, all still pending", async () => {
    const summary = await runItauIngest({ fetcher: async () => batch([
      aviso({ messageId: "<auth-pass@example.test>", authenticationResults: [PASS] }),
      aviso({ messageId: "<auth-fail@example.test>", authenticationResults: [FAIL] }),
      aviso({ messageId: "<auth-unaligned@example.test>", authenticationResults: [` ${RECEIVER}; dkim=pass header.d=esp.example`] }),
      aviso({ messageId: "<auth-none@example.test>" })
    ]) });
    expect(summary).toEqual({ messagesSeen: 4, inserted: 4, skipped: 0 });
    expect(storedVerdicts()).toEqual({
      "<auth-pass@example.test>": "pass", "<auth-fail@example.test>": "fail",
      "<auth-unaligned@example.test>": "fail", "<auth-none@example.test>": "none"
    });
    const rows = listTransactions();
    expect(rows.every((row) => row.status === "pending")).toBe(true);
    expect(rows.map((row) => row.senderAuth).sort()).toEqual(["fail", "fail", "none", "pass"]);
  });

  it("stores fail when only a lower, spoofed header claims pass (configured authserv-id)", async () => {
    process.env.ITAU_IMAP_AUTHSERV_ID = RECEIVER;
    await runItauIngest({ fetcher: async () => batch([
      aviso({ messageId: "<forged-configured@example.test>", authenticationResults: [FAIL, PASS] }),
      aviso({ messageId: "<forged-other-id@example.test>", authenticationResults: [PASS.replace(RECEIVER, "attacker.example")] })
    ]) });
    expect(storedVerdicts()).toEqual({ "<forged-configured@example.test>": "fail", "<forged-other-id@example.test>": "none" });
  });

  it("stores fail when only a lower, spoofed header claims pass (topmost header, no authserv-id configured)", async () => {
    await runItauIngest({ fetcher: async () => batch([
      aviso({ messageId: "<forged-topmost@example.test>", authenticationResults: [FAIL, PASS] })
    ]) });
    expect(storedVerdicts()).toEqual({ "<forged-topmost@example.test>": "fail" });
  });

  it("keeps NULL for rows imported without a verdict (legacy rows)", () => {
    insertImportedTransaction({ txnDate: "2026-06-01T12:00:00.000Z", description: "Legacy", currencyCode: "UYU", amountMinor: 100, source: "itau_email", messageId: "<legacy@example.test>", status: "pending" });
    expect(storedVerdicts()).toEqual({ "<legacy@example.test>": null });
    expect(listTransactions()[0].senderAuth).toBeNull();
  });

  it("does not change observed spending", async () => {
    await runItauIngest({ fetcher: async () => batch([
      aviso({ messageId: "<spend-pass@example.test>", authenticationResults: [PASS] }),
      aviso({ messageId: "<spend-fail@example.test>", authenticationResults: [FAIL] }),
      aviso({ messageId: "<spend-none@example.test>" })
    ]) });
    const rows = listTransactions(Number.MAX_SAFE_INTEGER);
    const minorUnits = new Map(listCurrencies().map((currency) => [currency.code, currency.minorUnit]));
    const observed = calculateActualMonth("2026-06", rows, [], minorUnits);
    const withoutVerdicts = calculateActualMonth("2026-06", rows.map((row) => ({ ...row, senderAuth: null })), [], minorUnits);
    expect(observed).toEqual(withoutVerdicts);
    expect(observed.totals).toEqual([{ currency: "UYU", amountMinor: 3 * 19900 }]);
  });
});
