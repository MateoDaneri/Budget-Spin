import type { Currency, IncomeItem, RecurringExpense } from "@/src/db/repository";
import { toBaseMinor } from "./money";
import { countOccurrencesInMonth } from "./recurrence";

export type MonthMetrics = {
  month: string;
  incomeBaseMinor: number;
  expenseBaseMinor: number;
  optionalExpenseBaseMinor: number;
  expenseWithOptionalBaseMinor: number;
  netBaseMinor: number;
  netWithOptionalBaseMinor: number;
  expenseByCategory: Array<{ categoryName: string; amountBaseMinor: number }>;
  optionalExpenseByCategory: Array<{ categoryName: string; amountBaseMinor: number }>;
  expenseWithOptionalByCategory: Array<{ categoryName: string; amountBaseMinor: number }>;
  expenseByGroup: Array<{ groupName: string; amountBaseMinor: number }>;
  optionalExpenseByGroup: Array<{ groupName: string; amountBaseMinor: number }>;
  expenseWithOptionalByGroup: Array<{ groupName: string; amountBaseMinor: number }>;
};

export function calculateMonthMetrics(input: {
  month: string;
  incomes: IncomeItem[];
  expenses: RecurringExpense[];
  currencies: Currency[];
  baseCurrency: Currency;
}): MonthMetrics {
  const currencyByCode = new Map(input.currencies.map((currency) => [currency.code, currency]));
  let incomeBaseMinor = 0;
  let expenseBaseMinor = 0;
  let optionalExpenseBaseMinor = 0;
  const expenseByCategory = new Map<string, number>();
  const optionalExpenseByCategory = new Map<string, number>();
  const expenseByGroup = new Map<string, number>();
  const optionalExpenseByGroup = new Map<string, number>();

  for (const income of input.incomes) {
    const occurrences = countOccurrencesInMonth({
      frequency: income.frequency,
      customInterval: income.customInterval,
      customUnit: income.customUnit,
      customAnchor: income.customAnchor,
      customDayOfMonth: income.customDayOfMonth,
      customDayOfWeek: income.customDayOfWeek,
      startDate: income.startDate,
      endDate: income.endDate,
      month: input.month
    });
    const currency = requireCurrency(currencyByCode, income.currencyCode);
    incomeBaseMinor +=
      occurrences *
      toBaseMinor({
        amountMinor: income.amountMinor,
        currency,
        baseCurrency: input.baseCurrency,
        fxRateToBase: income.fxRateToBase
      });
  }

  for (const expense of input.expenses) {
    const occurrences = countOccurrencesInMonth({
      frequency: expense.frequency,
      customInterval: expense.customInterval,
      customUnit: expense.customUnit,
      customAnchor: expense.customAnchor,
      customDayOfMonth: expense.customDayOfMonth,
      customDayOfWeek: expense.customDayOfWeek,
      startDate: expense.startDate,
      endDate: expense.endDate,
      month: input.month
    });
    const currency = requireCurrency(currencyByCode, expense.currencyCode);
    const amountBaseMinor =
      occurrences *
      toBaseMinor({
        amountMinor: expense.amountMinor,
        currency,
        baseCurrency: input.baseCurrency,
        fxRateToBase: expense.fxRateToBase
      });

    if (amountBaseMinor === 0) {
      continue;
    }

    const targetCategoryTotal = expense.isOptional ? optionalExpenseByCategory : expenseByCategory;
    const targetGroupTotal = expense.isOptional ? optionalExpenseByGroup : expenseByGroup;

    if (expense.isOptional) {
      optionalExpenseBaseMinor += amountBaseMinor;
    } else {
      expenseBaseMinor += amountBaseMinor;
    }

    targetCategoryTotal.set(expense.categoryName, (targetCategoryTotal.get(expense.categoryName) ?? 0) + amountBaseMinor);
    targetGroupTotal.set(expense.groupName, (targetGroupTotal.get(expense.groupName) ?? 0) + amountBaseMinor);
  }

  const expenseWithOptionalByCategory = mergeTotals(expenseByCategory, optionalExpenseByCategory);
  const expenseWithOptionalByGroup = mergeTotals(expenseByGroup, optionalExpenseByGroup);

  return {
    month: input.month,
    incomeBaseMinor,
    expenseBaseMinor,
    optionalExpenseBaseMinor,
    expenseWithOptionalBaseMinor: expenseBaseMinor + optionalExpenseBaseMinor,
    netBaseMinor: incomeBaseMinor - expenseBaseMinor,
    netWithOptionalBaseMinor: incomeBaseMinor - expenseBaseMinor - optionalExpenseBaseMinor,
    expenseByCategory: sortNamedTotals(expenseByCategory, "categoryName"),
    optionalExpenseByCategory: sortNamedTotals(optionalExpenseByCategory, "categoryName"),
    expenseWithOptionalByCategory: sortNamedTotals(expenseWithOptionalByCategory, "categoryName"),
    expenseByGroup: sortNamedTotals(expenseByGroup, "groupName"),
    optionalExpenseByGroup: sortNamedTotals(optionalExpenseByGroup, "groupName"),
    expenseWithOptionalByGroup: sortNamedTotals(expenseWithOptionalByGroup, "groupName")
  };
}

function mergeTotals(...totals: Array<Map<string, number>>) {
  const merged = new Map<string, number>();

  for (const total of totals) {
    for (const [name, amountBaseMinor] of total) {
      merged.set(name, (merged.get(name) ?? 0) + amountBaseMinor);
    }
  }

  return merged;
}

function sortNamedTotals<TName extends "categoryName" | "groupName">(totals: Map<string, number>, nameKey: TName) {
  return Array.from(totals.entries())
    .filter(([, amountBaseMinor]) => amountBaseMinor !== 0)
    .map(([name, amountBaseMinor]) => ({ [nameKey]: name, amountBaseMinor }) as Record<TName, string> & { amountBaseMinor: number })
    .sort((a, b) => b.amountBaseMinor - a.amountBaseMinor);
}

function requireCurrency(currencies: Map<string, Currency>, code: string) {
  const currency = currencies.get(code);
  if (!currency) {
    throw new Error(`Unknown currency: ${code}`);
  }

  return currency;
}
