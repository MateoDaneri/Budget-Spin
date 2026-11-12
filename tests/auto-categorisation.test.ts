import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import { deactivateCategory, insertImportedTransaction, listCategories, listTransactions, migrate, setTransactionCategory } from "@/src/db/repository";
import { runItauIngest } from "@/src/ingest/ingest-itau";
import type { ItauEmailInput } from "@/src/ingest/itau-parser";
import { listSplitwiseImports, saveSplitwiseSnapshot, setSplitwiseCategory } from "@/src/splitwise/store";

// All merchants below are invented.
let dbPath: string;
let messageCounter = 0;
beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `autocat-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  process.env.ITAU_IMAP_STATE_DIR = `${dbPath}-state`;
  process.env.ITAU_IMAP_HOST = "imap.example.test";
  process.env.ITAU_IMAP_USER = "reader@example.test";
  process.env.ITAU_IMAP_PASSWORD = "synthetic";
  closeDb();
  migrate();
});
afterEach(() => {
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(dbPath + suffix, { force: true });
  fs.rmSync(`${dbPath}-state`, { recursive: true, force: true });
  for (const key of ["DATABASE_PATH", "ITAU_IMAP_STATE_DIR", "ITAU_IMAP_HOST", "ITAU_IMAP_USER", "ITAU_IMAP_PASSWORD"]) delete process.env[key];
});

function category(name: string): number {
  const found = listCategories("expense").find((item) => item.name === name);
  if (!found) throw new Error(`missing category ${name}`);
  return found.id;
}

function purchase(description: string): number {
  const messageId = `<autocat-${++messageCounter}@example.test>`;
  insertImportedTransaction({ txnDate: "2026-03-01T12:00:00.000Z", description, currencyCode: "UYU", amountMinor: 1000, source: "itau_email", messageId });
  const row = listTransactions().find((item) => item.messageId === messageId);
  if (!row) throw new Error("insert failed");
  return row.id;
}

function categoryOf(id: number): number | null {
  return listTransactions().find((row) => row.id === id)?.categoryId ?? null;
}

describe("automatic categorisation of bank purchases", () => {
  it("files a new purchase at an already-categorised merchant under that category", () => {
    const first = purchase("MERCADO DE PRUEBA 9");
    setTransactionCategory(first, category("Food"));
    expect(categoryOf(purchase("MERCADO DE PRUEBA 14"))).toBe(category("Food"));
    expect(categoryOf(purchase("COMERCIO DE PRUEBA*TEST*00 ABCDE"))).toBe(category("Other"));
  });

  it("uses the card-notice shape: a different id and location word still match", () => {
    setTransactionCategory(purchase("COMERCIO DE PRUEBA*TEST*00 ABCDE"), category("Transport"));
    expect(categoryOf(purchase("COMERCIO DE PRUEBA*TEST*31 FGHIJ"))).toBe(category("Transport"));
  });

  it("sends an unknown merchant to Other", () => {
    expect(categoryOf(purchase("KIOSCO INVENTADO 3"))).toBe(category("Other"));
  });

  it("prefers the exact-description rule over the merchant rule, and the latest choice wins for the merchant", () => {
    setTransactionCategory(purchase("TIENDA FICTICIA 1"), category("Food"));
    setTransactionCategory(purchase("TIENDA FICTICIA 2"), category("Transport"));
    expect(categoryOf(purchase("TIENDA FICTICIA 1"))).toBe(category("Food"));
    expect(categoryOf(purchase("TIENDA FICTICIA 2"))).toBe(category("Transport"));
    expect(categoryOf(purchase("TIENDA FICTICIA 3"))).toBe(category("Transport"));
  });

  it("applies the owner's later change to the next import", () => {
    const first = purchase("FARMACIA IMAGINARIA 5");
    setTransactionCategory(first, category("Food"));
    setTransactionCategory(first, category("Health"));
    expect(categoryOf(purchase("FARMACIA IMAGINARIA 6"))).toBe(category("Health"));
  });

  it("never rewrites categories already stored on other movements", () => {
    const a = purchase("TIENDA FICTICIA 1");
    const b = purchase("TIENDA FICTICIA 2");
    const sameText = purchase("TIENDA FICTICIA 1");
    expect(categoryOf(b)).toBe(category("Other"));
    setTransactionCategory(a, category("Food"));
    migrate();
    expect(categoryOf(a)).toBe(category("Food"));
    expect(categoryOf(b)).toBe(category("Other"));
    // Same behaviour as before for exact matches: only the edited row changes.
    expect(categoryOf(sameText)).toBe(category("Other"));
  });

  it("skips the merchant lookup when the merchant key is too generic", () => {
    setTransactionCategory(purchase("AB 12"), category("Food"));
    expect(categoryOf(purchase("AB 34"))).toBe(category("Other"));
    expect(categoryOf(purchase("AB 12"))).toBe(category("Food"));
  });

  it("falls back to Other when the merchant rule points at a deactivated category", () => {
    setTransactionCategory(purchase("LIBRERIA FICTICIA 2"), category("Health"));
    deactivateCategory(category("Health"));
    expect(categoryOf(purchase("LIBRERIA FICTICIA 8"))).toBe(category("Other"));
  });

  it("applies the merchant rule to purchases ingested from purchase notices", async () => {
    const html = fs.readFileSync(path.resolve(__dirname, "fixtures/itau-debit-synthetic.html"), "utf8");
    const notice = (uid: number, merchant: string): ItauEmailInput => ({
      subject: "Aviso de consumo aprobado con tarjeta de débito", from: "comunicaciones@itau.com.uy",
      date: new Date("2026-03-02T12:00:00Z"), messageId: `<autocat-ingest-${uid}@example.test>`, uid,
      html: html.replace("MERCADO DE PRUEBA 9", merchant)
    });
    await runItauIngest({ fetcher: async () => ({ messages: [notice(1, "MERCADO DE PRUEBA 9")], cursor: { uidValidity: "1", lastUid: 1 }, hasMore: false }) });
    setTransactionCategory(listTransactions()[0].id, category("Food"));
    await runItauIngest({ fetcher: async () => ({ messages: [notice(2, "MERCADO DE PRUEBA 21"), notice(3, "KIOSCO INVENTADO 4")], cursor: { uidValidity: "1", lastUid: 3 }, hasMore: false }) });
    const rows = listTransactions();
    expect(rows.find((row) => row.description === "MERCADO DE PRUEBA 21")?.categoryId).toBe(category("Food"));
    expect(rows.find((row) => row.description === "KIOSCO INVENTADO 4")?.categoryId).toBe(category("Other"));
  });
});

describe("automatic categorisation of Splitwise imports", () => {
  const expense = { id: 1, date: "2026-03-01T00:00:00Z", description: "Cena Ficticia 1", currency: "UYU", total: "20.00", paid: "20.00", owed: "10.00", payment: false, deleted: false };
  const saved = (id: number) => listSplitwiseImports().expenses.find((row) => row.id === id)?.categoryId;

  it("follows the same exact → merchant → Other lookup and never rewrites stored rows", () => {
    saveSplitwiseSnapshot(42, [expense, { ...expense, id: 2, description: "Cena Ficticia 2" }]);
    setSplitwiseCategory(1, category("Food"));
    saveSplitwiseSnapshot(42, [
      expense,
      { ...expense, id: 2, description: "Cena Ficticia 2" },
      { ...expense, id: 3, description: "Cena Ficticia 3" },
      { ...expense, id: 4, description: "Regalo Inventado" }
    ]);
    expect(saved(1)).toBe(category("Food"));
    expect(saved(2)).toBe(category("Other"));
    expect(saved(3)).toBe(category("Food"));
    expect(saved(4)).toBe(category("Other"));
  });

  it("shares merchant rules with bank purchases", () => {
    setTransactionCategory(purchase("MERCADO DE PRUEBA 9"), category("Food"));
    saveSplitwiseSnapshot(42, [{ ...expense, id: 5, description: "Mercado de Prueba 3" }]);
    expect(saved(5)).toBe(category("Food"));
  });
});
