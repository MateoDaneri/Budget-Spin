import type { Transaction } from "@/src/db/repository";
import type { SavedSplitwiseExpense } from "@/src/splitwise/store";

/** An observed amount is not a bank statement and is never mixed with a plan. */
export type ActualMonth = {
  totals: Array<{ currency: string; amountMinor: number }>;
  matched: number;
  ambiguous: number;
  omitted: number;
  pending: number;
  pairs: Array<{ bankId: number; splitwiseId: number; description: string; currency: string; paidMinor: number; owedMinor: number }>;
};

type Bank = Pick<Transaction, "id" | "txnDate" | "description" | "currencyCode" | "amountMinor" | "kind" | "status">;
type Shared = Pick<SavedSplitwiseExpense, "id" | "date" | "description" | "currency" | "paid" | "owed" | "total" | "payment" | "deleted">;

function keyName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
function minor(value: string | null): number | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- Both digit groups are bounded and separated by a literal dot.
  if (value === null || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
function day(value: string): string { return value.slice(0, 10); }

/**
 * Exact, mutual-unique match only. Payments, deletions, unsupported currencies,
 * negative/refund-like values and unclear self-paid shares stay outside totals.
 * The displayed totals are provisional, not an inferred cash balance.
 */
export function calculateActualMonth(month: string, bank: Bank[], shared: Shared[], exclusions: Array<{ bankId: number; splitwiseId: number }> = []): ActualMonth {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month.");
  const purchases = bank.filter((x) => x.kind === "purchase" && x.status !== "discarded" && x.amountMinor > 0 && x.txnDate.startsWith(month));
  const expenses = shared.filter((x) => !x.deleted && !x.payment && x.date.startsWith(month));
  const matches = (b: Bank, s: Shared) => {
    const paid = minor(s.paid);
    return !exclusions.some((entry) => entry.bankId === b.id && entry.splitwiseId === s.id) && ["UYU", "USD"].includes(s.currency) && paid !== null && paid > 0 && paid === b.amountMinor && s.currency === b.currencyCode &&
      day(s.date) === day(b.txnDate) && keyName(s.description).length > 0 && keyName(s.description) === keyName(b.description);
  };
  const sums = new Map<string, number>();
  const add = (currency: string, amount: number) => sums.set(currency, (sums.get(currency) ?? 0) + amount);
  let matched = 0, ambiguous = 0, omitted = 0;
  const used = new Set<number>();
  const pairs: ActualMonth["pairs"] = [];
  for (const b of purchases) {
    const eligible = expenses.filter((s) => matches(b, s));
    if (eligible.length === 1) {
      const candidate = eligible[0];
      const owed = minor(candidate.owed);
      const total = minor(candidate.total);
      if (owed !== null && total !== null && owed <= total && b.amountMinor <= total && purchases.filter((other) => matches(other, candidate)).length === 1) {
        add(b.currencyCode, owed); used.add(candidate.id); matched++;
        pairs.push({ bankId: b.id, splitwiseId: candidate.id, description: b.description, currency: b.currencyCode, paidMinor: b.amountMinor, owedMinor: owed }); continue;
      }
    }
    add(b.currencyCode, b.amountMinor);
  }
  for (const s of expenses) {
    if (used.has(s.id)) continue;
    const owed = minor(s.owed), paid = minor(s.paid), total = minor(s.total);
    // Splitwise uses two decimal places; do not guess minor units for other currencies.
    if (!['UYU', 'USD'].includes(s.currency) || owed === null || paid === null || total === null || owed > total || paid > total) { omitted++; continue; }
    const resemblesBank = purchases.some((b) => b.currencyCode === s.currency && day(b.txnDate) === day(s.date) && keyName(b.description) === keyName(s.description));
    if (paid === 0 && !resemblesBank) add(s.currency, owed);
    else if (owed > 0 || paid > 0) ambiguous++;
  }
  return { totals: [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor })), matched, ambiguous, omitted, pending: purchases.filter((x) => x.status === "pending").length, pairs };
}
