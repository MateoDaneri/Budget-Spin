import type { ActualMonth } from "./actual-spending";
import { addMonths, dateOnly, monthBounds, parseDateOnly } from "./dates";
import { listOccurrences, type RecurrenceSchedule } from "./recurrence";

/**
 * Real net and running balance per currency (FINANCIAL-RULES, "Real net and balance").
 * Pure: everything is derived from listed rows on each read; nothing here is stored.
 * Amounts stay in each currency's own minor units; no exchange rate is applied.
 */

export type IncomeSchedule = RecurrenceSchedule & { currencyCode: string; amountMinor: number };
export type OpeningBalance = { currencyCode: string; amountMinor: number; asOfDate: string };
export type BalanceAdjustment = { id: number; currencyCode: string; amountMinor: number; adjustmentDate: string; note: string; createdAt: string };
export type CurrencyNet = { currency: string; incomeMinor: number; spentMinor: number; netMinor: number };
export type CurrencyBalance = {
  currency: string;
  asOfDate: string;
  openingMinor: number;
  incomeMinor: number;
  spentMinor: number;
  adjustmentsMinor: number;
  balanceMinor: number;
};
export type DataQuality = { pending: number; ambiguous: number; omitted: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed income for the whole month minus the month's observed spending, per currency. */
export function monthlyNetByCurrency(month: string, incomes: IncomeSchedule[], actual: Pick<ActualMonth, "contributions">): CurrencyNet[] {
  const { start, end } = monthBounds(month);
  const income = new Map<string, number>();
  const spent = new Map<string, number>();

  for (const item of incomes) {
    const occurrences = listOccurrences(item, dateOnly(start), dateOnly(end)).length;
    if (occurrences > 0) add(income, item.currencyCode, occurrences * item.amountMinor);
  }
  for (const item of actual.contributions) add(spent, item.currency, item.amountMinor);

  return [...new Set([...income.keys(), ...spent.keys()])].sort().map((currency) => {
    const incomeMinor = income.get(currency) ?? 0;
    const spentMinor = spent.get(currency) ?? 0;
    return { currency, incomeMinor, spentMinor, netMinor: incomeMinor - spentMinor };
  });
}

/**
 * Balance at `today` for each currency with an opening balance: opening + income − spending + adjustments,
 * counting only movements dated after the opening date and on or before `today`.
 * `quality` sums the review counters of every month walked; it can include notices dated before an
 * opening date in the first month, so it errs towards flagging the figure as provisional.
 */
export function balanceByCurrency(input: {
  today: string;
  openings: OpeningBalance[];
  incomes: IncomeSchedule[];
  adjustments: BalanceAdjustment[];
  actualForMonth: (month: string) => ActualMonth;
}): { balances: CurrencyBalance[]; quality: DataQuality } {
  const quality: DataQuality = { pending: 0, ambiguous: 0, omitted: 0 };
  const active = input.openings.filter((opening) => opening.asOfDate < input.today);
  const contributions: ActualMonth["contributions"] = [];

  if (active.length > 0) {
    const firstMonth = active.map((opening) => opening.asOfDate.slice(0, 7)).sort()[0];
    const lastMonth = input.today.slice(0, 7);
    for (let month = firstMonth; month <= lastMonth; month = addMonths(month, 1)) {
      const actual = input.actualForMonth(month);
      contributions.push(...actual.contributions);
      quality.pending += actual.pending;
      quality.ambiguous += actual.ambiguous;
      quality.omitted += actual.omitted;
    }
  }

  const balances = [...input.openings]
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))
    .map((opening) => {
      const after = opening.asOfDate;
      const inWindow = (date: string) => date > after && date <= input.today;
      let incomeMinor = 0;
      let spentMinor = 0;
      let adjustmentsMinor = 0;

      if (after < input.today) {
        const firstDay = dateOnly(new Date(parseDateOnly(after).getTime() + DAY_MS));
        for (const item of input.incomes) {
          if (item.currencyCode === opening.currencyCode) {
            incomeMinor += listOccurrences(item, firstDay, input.today).length * item.amountMinor;
          }
        }
        for (const item of contributions) {
          if (item.currency === opening.currencyCode && inWindow(item.date)) spentMinor += item.amountMinor;
        }
        for (const item of input.adjustments) {
          if (item.currencyCode === opening.currencyCode && inWindow(item.adjustmentDate)) adjustmentsMinor += item.amountMinor;
        }
      }

      return {
        currency: opening.currencyCode,
        asOfDate: opening.asOfDate,
        openingMinor: opening.amountMinor,
        incomeMinor,
        spentMinor,
        adjustmentsMinor,
        balanceMinor: opening.amountMinor + incomeMinor - spentMinor + adjustmentsMinor
      };
    });

  return { balances, quality };
}

function add(totals: Map<string, number>, currency: string, amountMinor: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + amountMinor);
}
