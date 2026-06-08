import type { Currency, FinancialPlan, IncomeItem, PlanItem, RecurringExpense } from "@/src/db/repository";
import { addMonths, currentMonthKey } from "./dates";
import { calculateMonthMetrics } from "./metrics";
import { toBaseMinor } from "./money";

export type PlanProjection = {
  targetBaseMinor: number;
  itemPlannedBaseMinor: number;
  itemDoneBaseMinor: number;
  remainingBaseMinor: number;
  monthsToTarget: string[];
  monthlyInputs: PlanMonthlyInput[];
  monthlyRequiredBaseMinor: number;
  committedAvailableBaseMinor: number;
  withOptionalAvailableBaseMinor: number;
  committedGapBaseMinor: number;
  withOptionalGapBaseMinor: number;
};

export type PlanMonthlyInput = {
  month: string;
  incomeBaseMinor: number;
  committedExpenseBaseMinor: number;
  optionalExpenseBaseMinor: number;
  committedNetBaseMinor: number;
  netWithOptionalBaseMinor: number;
};

export function calculatePlanProjection(input: {
  plan: FinancialPlan;
  items: PlanItem[];
  incomes: IncomeItem[];
  expenses: RecurringExpense[];
  currencies: Currency[];
  baseCurrency: Currency;
  currentMonth?: string;
}): PlanProjection {
  const currentMonth = input.currentMonth ?? currentMonthKey();
  const targetMonth = input.plan.targetDate.slice(0, 7);
  const monthsToTarget = monthsInclusive(currentMonth, targetMonth);
  const targetBaseMinor = convertAmountToBase(
    {
      amountMinor: input.plan.targetAmountMinor,
      currencyCode: input.plan.currencyCode,
      fxRateToBase: input.plan.fxRateToBase
    },
    input.currencies,
    input.baseCurrency
  );
  const itemPlannedBaseMinor = sumItems(input.items, input.currencies, input.baseCurrency, false);
  const itemDoneBaseMinor = sumItems(input.items, input.currencies, input.baseCurrency, true);
  const remainingBaseMinor = Math.max(targetBaseMinor - itemDoneBaseMinor, 0);
  const monthlyRequiredBaseMinor =
    monthsToTarget.length > 0 ? Math.ceil(remainingBaseMinor / monthsToTarget.length) : remainingBaseMinor;
  let committedAvailableBaseMinor = 0;
  let withOptionalAvailableBaseMinor = 0;
  const monthlyInputs: PlanMonthlyInput[] = [];

  for (const month of monthsToTarget) {
    const metrics = calculateMonthMetrics({
      month,
      incomes: input.incomes,
      expenses: input.expenses,
      currencies: input.currencies,
      baseCurrency: input.baseCurrency
    });
    committedAvailableBaseMinor += metrics.netBaseMinor;
    withOptionalAvailableBaseMinor += metrics.netWithOptionalBaseMinor;
    monthlyInputs.push({
      month,
      incomeBaseMinor: metrics.incomeBaseMinor,
      committedExpenseBaseMinor: metrics.expenseBaseMinor,
      optionalExpenseBaseMinor: metrics.optionalExpenseBaseMinor,
      committedNetBaseMinor: metrics.netBaseMinor,
      netWithOptionalBaseMinor: metrics.netWithOptionalBaseMinor
    });
  }

  return {
    targetBaseMinor,
    itemPlannedBaseMinor,
    itemDoneBaseMinor,
    remainingBaseMinor,
    monthsToTarget,
    monthlyInputs,
    monthlyRequiredBaseMinor,
    committedAvailableBaseMinor,
    withOptionalAvailableBaseMinor,
    committedGapBaseMinor: committedAvailableBaseMinor - remainingBaseMinor,
    withOptionalGapBaseMinor: withOptionalAvailableBaseMinor - remainingBaseMinor
  };
}

export function monthsInclusive(startMonth: string, endMonth: string) {
  if (compareMonth(startMonth, endMonth) > 0) {
    return [];
  }

  const months: string[] = [];
  let cursor = startMonth;

  while (compareMonth(cursor, endMonth) <= 0) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return months;
}

function sumItems(items: PlanItem[], currencies: Currency[], baseCurrency: Currency, doneOnly: boolean) {
  return items.reduce((total, item) => {
    if (doneOnly && !item.isDone) {
      return total;
    }

    return total + convertAmountToBase(item, currencies, baseCurrency);
  }, 0);
}

function convertAmountToBase(
  value: {
    amountMinor: number;
    currencyCode: string;
    fxRateToBase: number | null;
  },
  currencies: Currency[],
  baseCurrency: Currency
) {
  const currency = currencies.find((item) => item.code === value.currencyCode);
  if (!currency) {
    throw new Error(`Unknown currency: ${value.currencyCode}`);
  }

  return toBaseMinor({
    amountMinor: value.amountMinor,
    currency,
    baseCurrency,
    fxRateToBase: value.fxRateToBase
  });
}

function compareMonth(left: string, right: string) {
  return left.localeCompare(right);
}
