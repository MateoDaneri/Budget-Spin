import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import { insertImportedTransaction, listCategories, listTransactions, setTransactionCategory } from "@/src/db/repository";
import { getSplitwiseSnapshot } from "@/src/splitwise/client";
import { listPairExclusions, listSplitwiseImports, saveSplitwiseSnapshot, setPairExclusion, setSplitwiseCategory } from "@/src/splitwise/store";

let dbPath: string;
const item = { id: 1, date: "2026-01-01T00:00:00Z", description: "Shared", currency: "USD", total: "20.00", paid: "20.00", owed: "8.00", payment: false, deleted: false };
beforeEach(() => { dbPath = path.join(os.tmpdir(), `splitwise-${crypto.randomUUID()}.sqlite`); process.env.DATABASE_PATH = dbPath; closeDb(); });
afterEach(() => { closeDb(); for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(dbPath + suffix, { force: true }); delete process.env.DATABASE_PATH; });

describe("separate Splitwise imports", () => {
  it("upserts the owner's share and keeps payments and deletions distinct from bank transactions", () => {
    saveSplitwiseSnapshot(42, [item]);
    saveSplitwiseSnapshot(42, [{ ...item, owed: "9.00", deleted: true }, { ...item, id: 2, payment: true }]);
    const rows = listSplitwiseImports().expenses;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === 1)).toMatchObject({ owed: "9.00", deleted: true });
    expect(rows.find((row) => row.id === 2)).toMatchObject({ payment: true });
    expect(listTransactions()).toEqual([]);
  });
  it("retains missing records and refuses to replace them with another account", () => {
    saveSplitwiseSnapshot(42, [item]);
    saveSplitwiseSnapshot(42, []);
    expect(() => saveSplitwiseSnapshot(43, [{ ...item, description: "Other" }])).toThrow("account changed");
    expect(listSplitwiseImports().expenses).toMatchObject([item]);
  });
  it("learns explicit category edits across sources and never overwrites them on sync", () => {
    saveSplitwiseSnapshot(42, [item]);
    const food = listCategories("expense").find((category) => category.name === "Food")!;
    setSplitwiseCategory(1, food.id);
    saveSplitwiseSnapshot(42, [{ ...item, owed: "10.00" }]);
    expect(listSplitwiseImports().expenses[0].categoryId).toBe(food.id);
    insertImportedTransaction({ txnDate: item.date, description: " shared ", currencyCode: "USD", amountMinor: 100, source: "itau_email", messageId: "abc" });
    expect(listTransactions()[0].categoryId).toBe(food.id);
    const transport = listCategories("expense").find((category) => category.name === "Transport")!;
    setTransactionCategory(listTransactions()[0].id, transport.id);
    saveSplitwiseSnapshot(42, [item, { ...item, id: 3, description: "SHARED" }]);
    expect(listSplitwiseImports().expenses.find((row) => row.id === 1)?.categoryId).toBe(food.id);
    expect(listSplitwiseImports().expenses.find((row) => row.id === 3)?.categoryId).toBe(transport.id);
  });
  it("persists explicit pair exclusions across Splitwise edits and allows restoration", () => {
    saveSplitwiseSnapshot(42, [item]);
    insertImportedTransaction({ txnDate: item.date, description: "Shared", currencyCode: "USD", amountMinor: 100, source: "itau_email", messageId: "<pair@example.test>" });
    const bankId = listTransactions()[0].id;
    setPairExclusion(bankId, 1, true);
    saveSplitwiseSnapshot(42, [{ ...item, owed: "10.00" }]);
    expect(listPairExclusions()).toEqual([{ bankId, splitwiseId: 1 }]);
    setPairExclusion(bankId, 1, false);
    expect(listPairExclusions()).toEqual([]);
    expect(() => setPairExclusion(bankId, 999, true)).toThrow();
  });
  it("paginates a bounded snapshot and uses only the authenticated user's share", async () => {
    const calls: string[] = [];
    const expense = { id: 1, date: item.date, description: item.description, cost: item.total, currency_code: item.currency, payment: false, deleted_at: null, users: [{ user_id: 42, paid_share: "20.00", owed_share: "8.00" }] };
    const fetcher: typeof fetch = async (url) => { calls.push(String(url)); return Response.json(String(url).includes("get_current_user") ? { user: { id: 42 } } : { expenses: [expense] }); };
    const snapshot = await getSplitwiseSnapshot("test", fetcher);
    expect(snapshot).toEqual({ accountId: 42, expenses: [item] });
    expect(new URL(calls[1]).searchParams.get("updated_before")).toBeTruthy();
    expect(new URL(calls[1]).searchParams.get("offset")).toBe("0");
  });
  it("preserves a signed provider refund for explicit exclusion rather than failing the snapshot", async () => {
    const expense = { id: 8, date: item.date, description: "Refund", cost: "-5.00", currency_code: "USD", payment: false, deleted_at: null, users: [{ user_id: 42, paid_share: "-5.00", owed_share: "-5.00" }] };
    const fetcher: typeof fetch = async (url) => Response.json(String(url).includes("get_current_user") ? { user: { id: 42 } } : { expenses: [expense] });
    const snapshot = await getSplitwiseSnapshot("test", fetcher);
    expect(snapshot.expenses[0]).toMatchObject({ total: "-5.00", paid: "-5.00", owed: "-5.00" });
  });
  it("does not yield a partial snapshot when a later page fails", async () => {
    const expense = { date: item.date, description: item.description, cost: item.total, currency_code: item.currency, payment: false, deleted_at: null, users: [{ user_id: 42, paid_share: "20.00", owed_share: "8.00" }] };
    const fetcher: typeof fetch = async (url) => {
      const address = String(url);
      if (address.includes("get_current_user")) return Response.json({ user: { id: 42 } });
      if (new URL(address).searchParams.get("offset") === "0") return Response.json({ expenses: Array.from({ length: 20 }, (_, index) => ({ ...expense, id: index + 1 })) });
      return new Response("private upstream detail", { status: 429 });
    };
    await expect(getSplitwiseSnapshot("test", fetcher)).rejects.toMatchObject({ kind: "rate-limit" });
    expect(listSplitwiseImports().expenses).toEqual([]);
  });
});
