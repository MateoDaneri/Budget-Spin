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
import { addBalanceAdjustmentAction, clearOpeningBalanceAction, deleteBalanceAdjustmentAction, saveOpeningBalanceAction } from "@/src/actions/balance";
import { closeDb } from "@/src/db/client";
import { listBalanceAdjustments, listOpeningBalances, migrate } from "@/src/db/repository";
import { dateOnly } from "@/src/finance/dates";

let dbPath: string;
const today = dateOnly(new Date());
const tomorrow = dateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

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

const saveOpening = (fields: Record<string, string>) => redirectedTo(saveOpeningBalanceAction(form({ currencyCode: "UYU", amount: "1000.00", asOfDate: today, ...fields })));
const addAdjustment = (fields: Record<string, string>) =>
  redirectedTo(addBalanceAdjustmentAction(form({ currencyCode: "UYU", amount: "-25.50", adjustmentDate: today, note: "cash", ...fields })));

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `balance-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  closeDb();
  migrate();
  vi.mocked(getCurrentSession).mockResolvedValue({ userId: "test-user", username: "tester" });
});

afterEach(() => {
  vi.clearAllMocks();
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(dbPath + suffix, { force: true });
  delete process.env.DATABASE_PATH;
});

describe("balance actions", () => {
  it("requires a session for every action and writes nothing without one", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect(await saveOpening({})).toBe("/login");
    expect(await addAdjustment({})).toBe("/login");
    expect(await redirectedTo(clearOpeningBalanceAction(form({ currencyCode: "UYU" })))).toBe("/login");
    expect(await redirectedTo(deleteBalanceAdjustmentAction(form({ id: 1 })))).toBe("/login");
    expect(listOpeningBalances()).toEqual([]);
    expect(listBalanceAdjustments()).toEqual([]);
  });

  it("saves and clears an opening balance, accepting a negative amount", async () => {
    expect(await saveOpening({ amount: "-1000.5" })).toBe("/balance");
    expect(listOpeningBalances()).toEqual([{ currencyCode: "UYU", amountMinor: -100050, asOfDate: today }]);
    expect(await redirectedTo(clearOpeningBalanceAction(form({ currencyCode: "UYU" })))).toBe("/balance");
    expect(listOpeningBalances()).toEqual([]);
  });

  it("rejects future dates, unknown currencies and extra precision with fixed codes", async () => {
    expect(await saveOpening({ asOfDate: tomorrow })).toBe("/balance?error=invalid-date");
    expect(await saveOpening({ asOfDate: "2026-02-30" })).toBe("/balance?error=invalid-date");
    expect(await saveOpening({ currencyCode: "XXX" })).toBe("/balance?error=unknown-currency");
    expect(await saveOpening({ amount: "12.345" })).toBe("/balance?error=invalid-signed-amount");
    expect(listOpeningBalances()).toEqual([]);
  });

  it("adds and deletes adjustments, requiring a note and a non-zero amount", async () => {
    expect(await addAdjustment({ note: "  " })).toBe("/balance?error=missing-field");
    expect(await addAdjustment({ amount: "0.00" })).toBe("/balance?error=invalid-signed-amount");
    expect(await addAdjustment({ adjustmentDate: tomorrow })).toBe("/balance?error=invalid-date");
    expect(listBalanceAdjustments()).toEqual([]);
    expect(await addAdjustment({})).toBe("/balance");
    const [saved] = listBalanceAdjustments();
    expect(saved).toMatchObject({ currencyCode: "UYU", amountMinor: -2550, adjustmentDate: today, note: "cash" });
    expect(await redirectedTo(deleteBalanceAdjustmentAction(form({ id: saved.id })))).toBe("/balance");
    expect(listBalanceAdjustments()).toEqual([]);
  });
});
