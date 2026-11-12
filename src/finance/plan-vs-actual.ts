import type { RecurringExpense } from "@/src/db/repository";
import { countOccurrencesInMonth } from "./recurrence";

export type CurrencyAmount = { currency: string; amountMinor: number };

export type PlanComparisonStatus = "under" | "on-plan" | "over" | "no-plan";

export type PlanComparison = {
  currency: string;
  /** Planned expense in the currency's own minor units; null when nothing is planned in that currency. */
  plannedMinor: number | null;
  observedMinor: number;
  /** observed - planned; positive means over plan. Null when there is no plan to compare with. */
  differenceMinor: number | null;
  status: PlanComparisonStatus;
  /** Bar widths (0-100) relative to the larger of planned and observed. Display only, never money. */
  plannedPercent: number;
  observedPercent: number;
};

type PlannedExpense = Pick<
  RecurringExpense,
  | "currencyCode"
  | "amountMinor"
  | "frequency"
  | "customInterval"
  | "customUnit"
  | "customAnchor"
  | "customDayOfMonth"
  | "customDayOfWeek"
  | "startDate"
  | "endDate"
>;

function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer of minor units.`);
  return value;
}

/**
 * Recurring expenses (committed and optional) active in the month, summed per original currency.
 * No exchange rate is applied: each total stays in the currency the expense was entered in.
 */
export function plannedExpenseByCurrency(month: string, expenses: PlannedExpense[]): CurrencyAmount[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const occurrences = countOccurrencesInMonth({ ...expense, month });
    if (occurrences === 0) continue;
    const amount = requireSafeInteger(occurrences * requireSafeInteger(expense.amountMinor, "Planned amount"), "Planned amount");
    totals.set(expense.currencyCode, requireSafeInteger((totals.get(expense.currencyCode) ?? 0) + amount, "Planned total"));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

function percentOf(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((part * 100) / whole)));
}

/** Pairs planned and observed amounts only when they share a currency; currencies are never mixed. */
export function comparePlanWithObserved(planned: CurrencyAmount[], observed: CurrencyAmount[]): PlanComparison[] {
  const plannedByCurrency = new Map<string, number>();
  for (const item of planned) plannedByCurrency.set(item.currency, requireSafeInteger(item.amountMinor, "Planned amount"));
  const observedByCurrency = new Map<string, number>();
  for (const item of observed) observedByCurrency.set(item.currency, requireSafeInteger(item.amountMinor, "Observed amount"));
  const currencies = [...new Set([...plannedByCurrency.keys(), ...observedByCurrency.keys()])].sort((a, b) => a.localeCompare(b));

  return currencies.map((currency): PlanComparison => {
    const plannedMinor = plannedByCurrency.get(currency) ?? null;
    const observedMinor = observedByCurrency.get(currency) ?? 0;
    if (plannedMinor === null) {
      return { currency, plannedMinor, observedMinor, differenceMinor: null, status: "no-plan", plannedPercent: 0, observedPercent: observedMinor > 0 ? 100 : 0 };
    }
    const differenceMinor = observedMinor - plannedMinor;
    const scale = Math.max(plannedMinor, observedMinor);
    const status: PlanComparisonStatus = differenceMinor > 0 ? "over" : differenceMinor === 0 ? "on-plan" : "under";
    return { currency, plannedMinor, observedMinor, differenceMinor, status, plannedPercent: percentOf(plannedMinor, scale), observedPercent: percentOf(observedMinor, scale) };
  });
}
