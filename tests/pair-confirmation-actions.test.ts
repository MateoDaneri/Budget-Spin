import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// redirect() throws in Next.js; the mock throws this so the action stops there.
const { RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    readonly url: string;

    constructor(url: string) {
      super("redirect");
      this.url = url;
    }
  }
  return { RedirectSignal };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  })
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/src/auth/session";
import { confirmPairAction, setPairExclusionAction, undoPairConfirmationAction } from "@/src/actions/reconciliation";
import { closeDb } from "@/src/db/client";
import { insertImportedTransaction, listCurrencies, listTransactions } from "@/src/db/repository";
import { calculateActualMonth } from "@/src/finance/actual-spending";
import { listPairConfirmations, listPairExclusions, listSplitwiseImports, saveSplitwiseSnapshot } from "@/src/splitwise/store";

// Synthetic records only.
const MONTH = "2026-11";
const OK = `/?month=${MONTH}#actual-spending`;
const failed = (code: string) => `/?month=${MONTH}&reconciliation=${code}#actual-spending`;
const expense = { id: 7, date: "2026-11-06T01:00:00Z", description: "Cena de prueba", currency: "UYU", total: "100.00", paid: "100.00", owed: "40.00", payment: false, deleted: false };

let dbPath: string;
let bankA: number;
let bankB: number;

function bank(description: string, txnDate: string, messageId: string): number {
  insertImportedTransaction({ txnDate, description, currencyCode: "UYU", amountMinor: 10000, source: "itau_email", messageId });
  const row = listTransactions().find((item) => item.messageId === messageId);
  if (!row) throw new Error("insert failed");
  return row.id;
}

function form(fields: Record<string, string | number>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

async function redirectedTo(action: Promise<unknown>): Promise<string> {
  const error = await action.then(
    () => {
      throw new Error("expected a redirect");
    },
    (reason: unknown) => reason
  );
  if (!(error instanceof RedirectSignal)) throw error;
  return error.url;
}

const confirm = (bankId: number | string, sharedId: number | string, month = MONTH) => redirectedTo(confirmPairAction(form({ bank: bankId, shared: sharedId, month })));
const undo = (bankId: number, sharedId: number) => redirectedTo(undoPairConfirmationAction(form({ bank: bankId, shared: sharedId, month: MONTH })));
const reject = (bankId: number, sharedId: number) => redirectedTo(setPairExclusionAction(form({ bank: bankId, shared: sharedId, month: MONTH, exclude: "yes" })));

function observedTotals() {
  const units = new Map(listCurrencies().map((currency) => [currency.code, currency.minorUnit]));
  return calculateActualMonth(MONTH, listTransactions(), listSplitwiseImports().expenses, units, listPairExclusions(), listPairConfirmations()).totals;
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `pairs-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  closeDb();
  vi.mocked(getCurrentSession).mockResolvedValue({ userId: "test-user", username: "tester" });
  saveSplitwiseSnapshot(42, [expense, { ...expense, id: 8, date: "2026-11-05T12:00:00Z", description: "Otra cena" }, { ...expense, id: 9, paid: "90.00" }]);
  bankA = bank("COMERCIO PRUEBA 01", "2026-11-05T23:30:00.000Z", "<pair-a@example.test>");
  bankB = bank("COMERCIO PRUEBA 02", "2026-11-06T10:00:00.000Z", "<pair-b@example.test>");
});

afterEach(() => {
  vi.clearAllMocks();
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(dbPath + suffix, { force: true });
  delete process.env.DATABASE_PATH;
});

describe("manual pair actions", () => {
  it("requires a session and stores nothing without one", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    expect(await confirm(bankA, 7)).toBe("/login");
    expect(listPairConfirmations()).toEqual([]);
  });

  it("refuses a second confirmation for the same bank purchase or Splitwise expense", async () => {
    expect(await confirm(bankA, 7)).toBe(OK);
    expect(await confirm(bankA, 7)).toBe(OK);
    expect(await confirm(bankA, 8)).toBe(failed("already-paired"));
    expect(await confirm(bankB, 7)).toBe(failed("already-paired"));
    expect(listPairConfirmations()).toEqual([{ bankId: bankA, splitwiseId: 7 }]);
  });

  it("keeps confirmation and rejection mutually exclusive", async () => {
    expect(await reject(bankA, 7)).toBe(OK);
    expect(listPairExclusions()).toEqual([{ bankId: bankA, splitwiseId: 7 }]);
    expect(await confirm(bankA, 7)).toBe(OK);
    expect(listPairExclusions()).toEqual([]);
    expect(listPairConfirmations()).toEqual([{ bankId: bankA, splitwiseId: 7 }]);
    expect(await reject(bankA, 7)).toBe(OK);
    expect(listPairConfirmations()).toEqual([]);
    expect(listPairExclusions()).toEqual([{ bankId: bankA, splitwiseId: 7 }]);
  });

  it("applies a confirmation to the totals and undo restores them", async () => {
    const before = observedTotals();
    expect(before).toEqual([{ currency: "UYU", amountMinor: 20000 }]);
    expect(await confirm(bankA, 7)).toBe(OK);
    expect(observedTotals()).toEqual([{ currency: "UYU", amountMinor: 14000 }]);
    expect(await undo(bankA, 7)).toBe(OK);
    expect(listPairConfirmations()).toEqual([]);
    expect(observedTotals()).toEqual(before);
    expect(await undo(bankA, 7)).toBe(failed("not-found"));
  });

  it("rejects invalid or unknown ids, a wrong month and amounts that do not match", async () => {
    expect(await confirm("abc", 7)).toBe(failed("not-found"));
    expect(await confirm(-1, 7)).toBe(failed("not-found"));
    expect(await confirm(999999, 7)).toBe(failed("not-found"));
    expect(await confirm(bankA, 999)).toBe(failed("not-found"));
    expect(await confirm(bankA, 9)).toBe(failed("pair-changed"));
    expect(await confirm(bankA, 7, "2026-10")).toBe(`/?month=2026-10&reconciliation=pair-changed#actual-spending`);
    expect(await confirm(bankA, 7, "not-a-month")).toBe("/");
    expect(listPairConfirmations()).toEqual([]);
  });

  it("ignores amounts sent in the form", async () => {
    const data = form({ bank: bankA, shared: 9, month: MONTH, paid: "100.00", amountMinor: 10000 });
    expect(await redirectedTo(confirmPairAction(data))).toBe(failed("pair-changed"));
    expect(listPairConfirmations()).toEqual([]);
  });
});
