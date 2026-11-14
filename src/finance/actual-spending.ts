import type { Transaction } from "@/src/db/repository";
import type { SavedSplitwiseExpense } from "@/src/splitwise/store";

/** One amount that enters the observed total, dated by the stored timestamp's YYYY-MM-DD prefix. */
export type ActualContribution = { date: string; currency: string; amountMinor: number; source: "bank" | "splitwise"; refId: number };

/** An observed amount is not a bank statement and is never mixed with planned expenses. */
export type ActualMonth = {
  /** Per-currency sum of `contributions`; never computed separately. */
  totals: Array<{ currency: string; amountMinor: number }>;
  contributions: ActualContribution[];
  matched: number;
  ambiguous: number;
  omitted: number;
  pending: number;
  pairs: Array<{ bankId: number; splitwiseId: number; description: string; currency: string; paidMinor: number; owedMinor: number; manual: boolean }>;
};

type Bank = Pick<Transaction, "id" | "txnDate" | "description" | "currencyCode" | "amountMinor" | "kind" | "status">;
type Shared = Pick<SavedSplitwiseExpense, "id" | "date" | "description" | "currency" | "paid" | "owed" | "total" | "payment" | "deleted">;

export type ActualBank = Bank;
export type ActualShared = Shared;

function keyName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
/** Largest exponent accepted from the currency table; keeps 10^unit and the result inside safe integers. */
const MAX_MINOR_UNIT = 6;
function supportedUnit(unit: number | undefined): unit is number {
  return unit !== undefined && Number.isInteger(unit) && unit >= 0 && unit <= MAX_MINOR_UNIT;
}
/**
 * Converts a Splitwise decimal string to integer minor units of its currency without floating-point math:
 * the digits are concatenated and parsed as one integer. Digits beyond the currency's minor unit are
 * accepted only when they are zeros (e.g. "1500.00" for a 0-decimal currency); any other excess
 * precision returns null so the amount is never rounded or silently rescaled.
 */
function minor(value: string | null, unit: number | undefined): number | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- Both digit groups are bounded and separated by a literal dot.
  if (value === null || !supportedUnit(unit) || !/^\d{1,15}(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/[^0]/.test(fraction.slice(unit))) return null;
  const result = Number(whole + fraction.slice(0, unit).padEnd(unit, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
function day(value: string): string { return value.slice(0, 10); }

/** Days since the epoch for the timestamp's UTC date prefix, or null when it is not a real YYYY-MM-DD date. */
function dayNumber(value: string): number | null {
  const text = day(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, monthNumber, dayOfMonth] = text.split("-").map(Number);
  const time = Date.UTC(year, monthNumber - 1, dayOfMonth);
  return new Date(time).toISOString().slice(0, 10) === text ? time / 86_400_000 : null;
}
function withinOneDay(a: string, b: string): boolean {
  const first = dayNumber(a), second = dayNumber(b);
  return first !== null && second !== null && Math.abs(first - second) <= 1;
}

/** A bank purchase and a Splitwise expense, identified by their local ids. */
export type PairRef = { bankId: number; splitwiseId: number };
/** A near match shown for review. It never changes totals until the owner confirms it. */
export type PairSuggestion = {
  bankId: number; splitwiseId: number; bankDescription: string; splitwiseDescription: string;
  bankDate: string; splitwiseDate: string; currency: string; paidMinor: number; owedMinor: number;
};
type ToMinor = (value: string | null, currency: string) => number | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
function assertMonth(month: string): void { if (!MONTH.test(month)) throw new Error("Invalid month."); }
// Splitwise amounts use the same configured minor unit as bank amounts, so sums share one scale.
function converter(minorUnits: ReadonlyMap<string, number>): ToMinor { return (value, currency) => minor(value, minorUnits.get(currency)); }
function inMonthPurchase(month: string, b: Bank): boolean { return b.kind === "purchase" && b.status !== "discarded" && b.amountMinor > 0 && b.txnDate.startsWith(month); }
function inMonthExpense(month: string, s: Shared): boolean { return !s.deleted && !s.payment && s.date.startsWith(month); }
function listed(entries: readonly PairRef[], b: Bank, s: Shared): boolean { return entries.some((entry) => entry.bankId === b.id && entry.splitwiseId === s.id); }
/** Same currency and the user's paid share equals the bank amount (> 0). */
function paidMatches(b: Bank, s: Shared, toMinor: ToMinor): boolean {
  const paid = toMinor(s.paid, s.currency);
  return s.currency === b.currencyCode && paid !== null && paid > 0 && paid === b.amountMinor;
}
/** The owed share that replaces the bank amount, or null when the amounts cannot support a pair. */
function pairedShare(b: Bank, s: Shared, toMinor: ToMinor): number | null {
  if (!paidMatches(b, s, toMinor)) return null;
  const owed = toMinor(s.owed, s.currency), total = toMinor(s.total, s.currency);
  return owed !== null && total !== null && owed <= total && b.amountMinor <= total ? owed : null;
}

/**
 * Pairs confirmed by the owner are applied first, then the exact, mutual-unique automatic rule.
 * Payments, deletions, unsupported currencies, negative/refund-like values and unclear self-paid
 * shares stay outside totals. The displayed totals are provisional, not an inferred cash balance.
 */
export function calculateActualMonth(month: string, bank: Bank[], shared: Shared[], minorUnits: ReadonlyMap<string, number>, exclusions: PairRef[] = [], confirmations: PairRef[] = []): ActualMonth {
  assertMonth(month);
  const toMinor = converter(minorUnits);
  const purchases = bank.filter((x) => inMonthPurchase(month, x));
  const expenses = shared.filter((x) => inMonthExpense(month, x));
  const contributions: ActualContribution[] = [];
  const fromBank = (b: Bank, amountMinor: number) => contributions.push({ date: day(b.txnDate), currency: b.currencyCode, amountMinor, source: "bank", refId: b.id });
  let matched = 0, ambiguous = 0, omitted = 0;
  const used = new Set<number>();
  const lockedBank = new Set<number>();
  const pairs: ActualMonth["pairs"] = [];
  // Manual confirmations take priority. A rejection of the same pair wins; the store keeps both exclusive.
  for (const entry of confirmations) {
    const b = purchases.find((x) => x.id === entry.bankId);
    const s = expenses.find((x) => x.id === entry.splitwiseId);
    if ((!b && !s) || (b && lockedBank.has(b.id)) || (s && used.has(s.id))) continue;
    if (b && s && listed(exclusions, b, s)) continue;
    if (b) lockedBank.add(b.id);
    if (s) used.add(s.id);
    const owed = b && s ? pairedShare(b, s, toMinor) : null;
    if (b && s && owed !== null) {
      fromBank(b, owed); matched++;
      pairs.push({ bankId: b.id, splitwiseId: s.id, description: b.description, currency: b.currencyCode, paidMinor: b.amountMinor, owedMinor: owed, manual: true });
      continue;
    }
    // Stale confirmation (amounts changed, or one side left the month): never applied, never guessed.
    omitted++;
    if (b) fromBank(b, b.amountMinor);
  }
  const free = purchases.filter((x) => !lockedBank.has(x.id));
  const open = expenses.filter((x) => !used.has(x.id));
  const matches = (b: Bank, s: Shared) => !listed(exclusions, b, s) && paidMatches(b, s, toMinor) &&
    day(s.date) === day(b.txnDate) && keyName(s.description).length > 0 && keyName(s.description) === keyName(b.description);
  for (const b of free) {
    const eligible = open.filter((s) => matches(b, s));
    if (eligible.length === 1) {
      const candidate = eligible[0];
      const owed = pairedShare(b, candidate, toMinor);
      if (owed !== null && free.filter((other) => matches(other, candidate)).length === 1) {
        fromBank(b, owed); used.add(candidate.id); matched++;
        pairs.push({ bankId: b.id, splitwiseId: candidate.id, description: b.description, currency: b.currencyCode, paidMinor: b.amountMinor, owedMinor: owed, manual: false }); continue;
      }
    }
    fromBank(b, b.amountMinor);
  }
  for (const s of expenses) {
    if (used.has(s.id)) continue;
    const owed = toMinor(s.owed, s.currency), paid = toMinor(s.paid, s.currency), total = toMinor(s.total, s.currency);
    // Unconfigured currencies and amounts finer than the currency's minor unit are omitted, never guessed.
    if (owed === null || paid === null || total === null || owed > total || paid > total) { omitted++; continue; }
    const resemblesBank = purchases.some((b) => b.currencyCode === s.currency && day(b.txnDate) === day(s.date) && keyName(b.description) === keyName(s.description));
    if (paid === 0 && !resemblesBank) contributions.push({ date: day(s.date), currency: s.currency, amountMinor: owed, source: "splitwise", refId: s.id });
    else if (owed > 0 || paid > 0) ambiguous++;
  }
  contributions.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.refId - b.refId);
  return { totals: totalsOf(contributions), contributions, matched, ambiguous, omitted, pending: purchases.filter((x) => x.status === "pending").length, pairs };
}

function totalsOf(contributions: readonly ActualContribution[]): ActualMonth["totals"] {
  const sums = new Map<string, number>();
  for (const item of contributions) sums.set(item.currency, (sums.get(item.currency) ?? 0) + item.amountMinor);
  return [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

/**
 * Near matches the exact rule did not pair: same currency, paid share == bank amount > 0, dates within
 * one UTC day, description free. Both sides must be unpaired (automatic or manual) and the pair not
 * rejected, and the candidate must be unique on both sides. Suggestions never change totals.
 */
export function suggestPairs(month: string, bank: Bank[], shared: Shared[], minorUnits: ReadonlyMap<string, number>, exclusions: PairRef[] = [], confirmations: PairRef[] = []): PairSuggestion[] {
  const { pairs } = calculateActualMonth(month, bank, shared, minorUnits, exclusions, confirmations);
  const pairedBank = new Set([...pairs, ...confirmations].map((entry) => entry.bankId));
  const pairedShared = new Set([...pairs, ...confirmations].map((entry) => entry.splitwiseId));
  const toMinor = converter(minorUnits);
  const purchases = bank.filter((x) => inMonthPurchase(month, x) && !pairedBank.has(x.id));
  const expenses = shared.filter((x) => inMonthExpense(month, x) && !pairedShared.has(x.id));
  const near = (b: Bank, s: Shared) => !listed(exclusions, b, s) && paidMatches(b, s, toMinor) && withinOneDay(b.txnDate, s.date);
  const suggestions: PairSuggestion[] = [];
  for (const b of purchases) {
    const candidates = expenses.filter((s) => near(b, s));
    if (candidates.length !== 1) continue;
    const s = candidates[0];
    if (purchases.filter((other) => near(other, s)).length !== 1) continue;
    const owed = pairedShare(b, s, toMinor);
    if (owed === null) continue;
    suggestions.push({ bankId: b.id, splitwiseId: s.id, bankDescription: b.description, splitwiseDescription: s.description, bankDate: day(b.txnDate), splitwiseDate: day(s.date), currency: b.currencyCode, paidMinor: b.amountMinor, owedMinor: owed });
  }
  return suggestions;
}

/**
 * Server-side check before storing a confirmation: both records are in the month, same currency,
 * within one UTC day, and the amounts support a pair now. Returns the owed share, or null.
 */
export function confirmablePair(month: string, b: Bank, s: Shared, minorUnits: ReadonlyMap<string, number>): number | null {
  assertMonth(month);
  if (!inMonthPurchase(month, b) || !inMonthExpense(month, s) || !withinOneDay(b.txnDate, s.date)) return null;
  return pairedShare(b, s, converter(minorUnits));
}
