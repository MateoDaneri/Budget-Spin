import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { archiveBillAction, saveBillAction, setBillPaidAction } from "@/src/actions/bills";
import { closeDb, getDb } from "@/src/db/client";
import { archiveBill, listBillPayments, listBills, migrate, setBillPaid, upsertBill } from "@/src/db/repository";
import { billsForMonth, type Bill } from "@/src/finance/bills";

const bill = (id: number, values: Partial<Bill> = {}): Bill => ({ id, name: `Bill ${id}`, amountMinor: null, currencyCode: null, dueDay: null, isActive: true, createdAt: "2026-10-03T12:00:00.000Z", ...values });

describe("billsForMonth", () => {
  it("orders by due day, bills without a day last, then by name", () => {
    const rows = billsForMonth("2026-11", [bill(1, { name: "Zeta" }), bill(2, { dueDay: 20 }), bill(3, { dueDay: 5, name: "B" }), bill(4, { dueDay: 5, name: "A" })], []);
    expect(rows.map((row) => row.id)).toEqual([4, 3, 2, 1]);
  });

  it("marks paid only for the requested month", () => {
    const rows = billsForMonth("2026-11", [bill(1), bill(2)], [
      { billId: 1, month: "2026-11", paidAt: "2026-11-04T10:00:00.000Z" },
      { billId: 2, month: "2026-10", paidAt: "2026-10-04T10:00:00.000Z" }
    ]);
    expect(rows.map((row) => [row.id, row.paidAt])).toEqual([[1, "2026-11-04T10:00:00.000Z"], [2, null]]);
  });

  it("hides bills before their creation month and removed bills unless paid that month", () => {
    const bills = [bill(1, { createdAt: "2026-12-01T00:00:00.000Z" }), bill(2, { isActive: false }), bill(3, { isActive: false })];
    const rows = billsForMonth("2026-11", bills, [{ billId: 3, month: "2026-11", paidAt: "2026-11-02T00:00:00.000Z" }]);
    expect(rows.map((row) => row.id)).toEqual([3]);
  });
});

let dbPath: string;

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

describe("bills storage and actions", () => {
  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `bills-${crypto.randomUUID()}.sqlite`);
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

  it("requires a session and writes nothing without one", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect(await redirectedTo(saveBillAction(form({ name: "Rent", month: "2026-11" })))).toBe("/login");
    expect(await redirectedTo(setBillPaidAction(form({ id: 1, paid: "yes", month: "2026-11" })))).toBe("/login");
    expect(await redirectedTo(archiveBillAction(form({ id: 1, month: "2026-11" })))).toBe("/login");
    expect(listBills()).toEqual([]);
  });

  it("creates, edits, pays, unpays and removes a bill", async () => {
    expect(await redirectedTo(saveBillAction(form({ name: " Accountant ", amount: "6000", currencyCode: "UYU", dueDay: "5", month: "2026-11" })))).toBe("/bills?month=2026-11");
    const [created] = listBills();
    expect(created).toMatchObject({ name: "Accountant", amountMinor: 600000, currencyCode: "UYU", dueDay: 5, isActive: true });

    expect(await redirectedTo(saveBillAction(form({ id: created.id, name: "Card", amount: "", dueDay: "", month: "2026-11" })))).toBe("/bills?month=2026-11");
    expect(listBills()[0]).toMatchObject({ name: "Card", amountMinor: null, currencyCode: null, dueDay: null });

    await redirectedTo(setBillPaidAction(form({ id: created.id, paid: "yes", month: "2026-11" })));
    await redirectedTo(setBillPaidAction(form({ id: created.id, paid: "yes", month: "2026-11" })));
    expect(listBillPayments("2026-11")).toHaveLength(1);
    expect(listBillPayments("2026-12")).toEqual([]);
    await redirectedTo(setBillPaidAction(form({ id: created.id, paid: "no", month: "2026-11" })));
    expect(listBillPayments("2026-11")).toEqual([]);

    await redirectedTo(setBillPaidAction(form({ id: created.id, paid: "yes", month: "2026-11" })));
    expect(await redirectedTo(archiveBillAction(form({ id: created.id, month: "2026-11" })))).toBe("/bills?month=2026-11");
    expect(listBills()[0].isActive).toBe(false);
    expect(listBillPayments("2026-11")).toHaveLength(1);
  });

  it("rejects bad input with fixed codes and writes nothing", async () => {
    const save = (fields: Record<string, string>) => redirectedTo(saveBillAction(form({ name: "X", month: "2026-11", ...fields })));
    expect(await save({ name: " " })).toBe("/bills?month=2026-11&error=missing-field");
    expect(await save({ amount: "10", currencyCode: "XXX" })).toBe("/bills?month=2026-11&error=unknown-currency");
    expect(await save({ amount: "1.000", currencyCode: "UYU" })).toBe("/bills?month=2026-11&error=invalid-amount");
    expect(await save({ amount: "-5", currencyCode: "UYU" })).toBe("/bills?month=2026-11&error=invalid-amount");
    expect(await save({ dueDay: "32" })).toBe("/bills?month=2026-11&error=invalid-number");
    expect(await redirectedTo(setBillPaidAction(form({ id: 999, paid: "yes", month: "2026-11" })))).toBe("/bills?month=2026-11&error=unexpected");
    expect(await redirectedTo(setBillPaidAction(form({ id: 1, paid: "maybe", month: "2026-11" })))).toBe("/bills?month=2026-11&error=invalid-option");
    expect(listBills()).toEqual([]);
  });

  it("falls back to the current month when the month field is malformed", async () => {
    const url = await redirectedTo(saveBillAction(form({ name: "Rent", month: "../../x" })));
    expect(url).toMatch(/^\/bills\?month=\d{4}-\d{2}$/);
  });

  it("enforces amount and currency together and a positive amount in the schema", () => {
    const db = getDb();
    expect(() => db.prepare("INSERT INTO bills (user_id, name, amount_minor, currency_code, created_at, updated_at) VALUES ('mdaneri','X',5,NULL,'t','t')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO bills (user_id, name, amount_minor, currency_code, created_at, updated_at) VALUES ('mdaneri','X',0,'UYU','t','t')").run()).toThrow();
    expect(() => upsertBill({ id: 12345, name: "X", amountMinor: null, currencyCode: null, dueDay: null })).toThrow();
    const id = upsertBill({ name: "Y", amountMinor: null, currencyCode: null, dueDay: 31 });
    archiveBill(id);
    expect(() => setBillPaid(id, "2026-11", true)).not.toThrow();
  });
});
