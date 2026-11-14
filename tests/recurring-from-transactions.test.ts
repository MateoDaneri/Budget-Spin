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
import { deleteContactAction, makeRecurringAction, saveContactAction } from "@/src/actions/transactions";
import { closeDb } from "@/src/db/client";
import { insertImportedTransaction, listCategories, listContacts, listRecurringExpenses, listRecurringMatchKeys, listTransactions, migrate } from "@/src/db/repository";
import { recurringMatchKey } from "@/src/finance/recurring-match";

describe("recurringMatchKey", () => {
  it("keys purchases by merchant, ignoring trailing store and terminal ids", () => {
    const a = recurringMatchKey({ kind: "purchase", description: "STREAMING EXAMPLE *SUBSCR +1234", currencyCode: "USD", amountMinor: 2000 });
    const b = recurringMatchKey({ kind: "purchase", description: "STREAMING EXAMPLE *SUBSCR +9876", currencyCode: "USD", amountMinor: 10000 });
    expect(a).toBe("merchant:streaming example subscr");
    expect(b).toBe(a);
  });

  it("keys outgoing transfers by destination digits and currency, whatever the amount or bank spelling", () => {
    const base = { kind: "transfer_out" as const, description: "Transferencia enviada", currencyCode: "UYU", counterpartyBank: "Banco  Ejemplo", counterpartyLast4: "1234" };
    expect(recurringMatchKey({ ...base, amountMinor: 390000 })).toBe("transfer-to:1234:UYU");
    expect(recurringMatchKey({ ...base, amountMinor: 420000 })).toBe("transfer-to:1234:UYU");
    expect(recurringMatchKey({ ...base, counterpartyBank: "Ejemplo", amountMinor: 1 })).toBe("transfer-to:1234:UYU");
    expect(recurringMatchKey({ ...base, currencyCode: "USD", amountMinor: 1 })).toBe("transfer-to:1234:USD");
  });

  it("keys outgoing transfers by currency and exact amount, and gives no key otherwise", () => {
    expect(recurringMatchKey({ kind: "transfer_out", description: "Transferencia enviada", currencyCode: "UYU", amountMinor: 150000 })).toBe("transfer:UYU:150000");
    expect(recurringMatchKey({ kind: "transfer_in", description: "x", currencyCode: "UYU", amountMinor: 1 })).toBeNull();
    expect(recurringMatchKey({ kind: "purchase", description: "12 34", currencyCode: "UYU", amountMinor: 1 })).toBeNull();
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

function movement(messageId: string, values: Partial<Parameters<typeof insertImportedTransaction>[0]> = {}) {
  insertImportedTransaction({ txnDate: "2026-10-10T12:00:00.000Z", description: "STREAMING EXAMPLE *SUBSCR +1234", currencyCode: "USD", amountMinor: 2000, source: "itau_email", messageId, ...values });
  const row = listTransactions().find((item) => item.messageId === messageId);
  if (!row) throw new Error("insert failed");
  return row.id;
}

describe("make recurring", () => {
  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `recurring-${crypto.randomUUID()}.sqlite`);
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

  const subscriptions = () => listCategories("expense").find((category) => category.name === "Subscriptions")!.id;

  it("requires a session and creates nothing without one", async () => {
    const id = movement("<a@example.test>");
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect(await redirectedTo(makeRecurringAction(form({ id, name: "Streaming", categoryId: subscriptions(), fxRateToBase: "40" })))).toBe("/login");
    expect(listRecurringExpenses()).toEqual([]);
  });

  it("creates a monthly expense from the stored movement, ignoring amounts in the form", async () => {
    const id = movement("<a@example.test>");
    const url = await redirectedTo(makeRecurringAction(form({ id, name: " Streaming ", categoryId: subscriptions(), fxRateToBase: "40,5", amountMinor: 1 })));
    expect(url).toBe("/transactions");
    expect(listRecurringExpenses()).toEqual([
      expect.objectContaining({ description: "Streaming", currencyCode: "USD", amountMinor: 2000, fxRateToBase: 40.5, frequency: "monthly", startDate: "2026-10-10", isOptional: false, matchKey: "merchant:streaming example subscr" })
    ]);
    expect(listRecurringMatchKeys()).toEqual(new Set(["merchant:streaming example subscr"]));
  });

  it("refuses a second expense for the same merchant", async () => {
    const first = movement("<a@example.test>");
    const second = movement("<b@example.test>", { description: "STREAMING EXAMPLE *SUBSCR +5555", txnDate: "2026-11-10T12:00:00.000Z" });
    await redirectedTo(makeRecurringAction(form({ id: first, name: "Streaming", categoryId: subscriptions(), fxRateToBase: "40" })));
    expect(await redirectedTo(makeRecurringAction(form({ id: second, name: "Again", categoryId: subscriptions(), fxRateToBase: "40" })))).toBe("/transactions?error=Already+recurring.");
    expect(listRecurringExpenses()).toHaveLength(1);
  });

  it("creates a transfer-based expense in the base currency without an FX rate", async () => {
    const id = movement("<t@example.test>", { kind: "transfer_out", description: "Transferencia enviada", currencyCode: "UYU", amountMinor: 150000, cardNetwork: null, cardLast4: null });
    await redirectedTo(makeRecurringAction(form({ id, name: "Parking", categoryId: subscriptions(), fxRateToBase: "99" })));
    expect(listRecurringExpenses()[0]).toMatchObject({ currencyCode: "UYU", amountMinor: 150000, fxRateToBase: null, matchKey: "transfer:UYU:150000" });
  });

  it("links a transfer with a known destination by destination, not amount", async () => {
    const id = movement("<d@example.test>", { kind: "transfer_out", description: "Transferencia enviada", currencyCode: "UYU", amountMinor: 390000, cardNetwork: null, cardLast4: null, counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234" });
    await redirectedTo(makeRecurringAction(form({ id, name: "Parking", categoryId: subscriptions() })));
    expect(listRecurringExpenses()[0]).toMatchObject({ amountMinor: 390000, matchKey: "transfer-to:1234:UYU" });
    expect(listTransactions().find((row) => row.id === id)).toMatchObject({ counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234" });
  });

  it("never stores a destination on a purchase", () => {
    const id = movement("<p@example.test>", { counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234" });
    expect(listTransactions().find((row) => row.id === id)).toMatchObject({ counterpartyBank: null, counterpartyLast4: null });
  });

  it("names a transfer destination from the stored transfer, updates it, and removes it", async () => {
    const id = movement("<c@example.test>", { kind: "transfer_out", description: "Transferencia enviada", currencyCode: "UYU", amountMinor: 1000, cardNetwork: null, cardLast4: null, counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234" });
    expect(await redirectedTo(saveContactAction(form({ id, name: " Friend ", last4: "9999" })))).toBe("/transactions");
    expect(listContacts()).toEqual([expect.objectContaining({ last4: "1234", name: "Friend", isOwn: false })]);
    await redirectedTo(saveContactAction(form({ id, name: "Mine", isOwn: "yes" })));
    const [contact] = listContacts();
    expect(contact).toMatchObject({ last4: "1234", name: "Mine", isOwn: true });
    expect(listContacts()).toHaveLength(1);
    await redirectedTo(deleteContactAction(form({ contactId: contact.id })));
    expect(listContacts()).toEqual([]);
  });

  it("refuses contacts without a session, without a destination or without a name", async () => {
    const purchase = movement("<p2@example.test>");
    const transfer = movement("<t2@example.test>", { kind: "transfer_out", description: "Transferencia enviada", currencyCode: "UYU", amountMinor: 1000, cardNetwork: null, cardLast4: null, counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234" });
    expect(await redirectedTo(saveContactAction(form({ id: purchase, name: "X" })))).toBe("/transactions?error=Could+not+save+contact.");
    expect(await redirectedTo(saveContactAction(form({ id: transfer, name: " " })))).toBe("/transactions?error=Could+not+save+contact.");
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect(await redirectedTo(saveContactAction(form({ id: transfer, name: "X" })))).toBe("/login");
    expect(listContacts()).toEqual([]);
  });

  it("rejects missing FX for a foreign currency, an income category, a bad id and an empty name", async () => {
    const id = movement("<a@example.test>");
    const income = listCategories("income")[0].id;
    const cases: Array<Record<string, string | number>> = [
      { id, name: "S", categoryId: subscriptions() },
      { id, name: "S", categoryId: income, fxRateToBase: "40" },
      { id: 99999, name: "S", categoryId: subscriptions(), fxRateToBase: "40" },
      { id, name: "  ", categoryId: subscriptions(), fxRateToBase: "40" },
      { id, name: "S", categoryId: subscriptions(), fxRateToBase: "abc" }
    ];
    for (const fields of cases) {
      expect(await redirectedTo(makeRecurringAction(form(fields)))).toBe("/transactions?error=Could+not+make+recurring.");
    }
    expect(listRecurringExpenses()).toEqual([]);
  });
});
