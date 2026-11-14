import { describe, expect, it } from "vitest";
import type { ActualContribution, ActualMonth } from "@/src/finance/actual-spending";
import { balanceByCurrency, monthlyNetByCurrency, type IncomeSchedule } from "@/src/finance/cash-position";

const income = (currencyCode: string, amountMinor: number, startDate: string, endDate: string | null = null): IncomeSchedule => ({ frequency: "monthly", startDate, endDate, currencyCode, amountMinor });
const spend = (date: string, currency: string, amountMinor: number, refId = 1): ActualContribution => ({ date, currency, amountMinor, source: "bank", refId });
const month = (contributions: ActualContribution[], counts: Partial<ActualMonth> = {}): ActualMonth => ({ totals: [], contributions, matched: 0, ambiguous: 0, omitted: 0, pending: 0, pairs: [], ...counts });
const byMonth = (all: ActualContribution[]) => (key: string) => month(all.filter((item) => item.date.startsWith(key)));

describe("monthlyNetByCurrency", () => {
  it("subtracts observed spending from fixed income per currency without conversion", () => {
    const result = monthlyNetByCurrency("2026-11", [income("UYU", 100000, "2026-01-01")], month([spend("2026-11-03", "UYU", 30000), spend("2026-11-04", "USD", 5000, 2)]));
    expect(result).toEqual([
      { currency: "USD", incomeMinor: 0, spentMinor: 5000, netMinor: -5000 },
      { currency: "UYU", incomeMinor: 100000, spentMinor: 30000, netMinor: 70000 }
    ]);
  });

  it("counts the whole month's income even when its date is still ahead", () => {
    expect(monthlyNetByCurrency("2026-11", [income("UYU", 100000, "2026-01-28")], month([]))).toEqual([{ currency: "UYU", incomeMinor: 100000, spentMinor: 0, netMinor: 100000 }]);
  });
});

describe("balanceByCurrency", () => {
  const base = { openings: [{ currencyCode: "UYU", amountMinor: 50000, asOfDate: "2026-10-31" }], adjustments: [] };

  it("counts only movements after the opening date and up to today", () => {
    const contributions = [spend("2026-10-31", "UYU", 1000), spend("2026-11-11", "UYU", 2000, 2)];
    const { balances } = balanceByCurrency({
      ...base,
      today: "2026-11-14",
      incomes: [income("UYU", 100000, "2026-01-01"), income("UYU", 100000, "2026-01-15")],
      adjustments: [{ id: 1, currencyCode: "UYU", amountMinor: -500, adjustmentDate: "2026-11-12", note: "cash", createdAt: "2026-11-12T00:00:00Z" }],
      actualForMonth: byMonth(contributions)
    });
    expect(balances).toEqual([{ currency: "UYU", asOfDate: "2026-10-31", openingMinor: 50000, incomeMinor: 100000, spentMinor: 2000, adjustmentsMinor: -500, balanceMinor: 147500 }]);
  });

  it("ignores adjustments dated on or before the opening date", () => {
    const { balances } = balanceByCurrency({
      ...base,
      today: "2026-11-14",
      incomes: [],
      adjustments: [{ id: 1, currencyCode: "UYU", amountMinor: 900, adjustmentDate: "2026-10-31", note: "old", createdAt: "2026-11-01T00:00:00Z" }],
      actualForMonth: byMonth([])
    });
    expect(balances[0].balanceMinor).toBe(50000);
  });

  it("has no balance row for a currency without an opening balance", () => {
    const { balances } = balanceByCurrency({
      openings: [{ currencyCode: "USD", amountMinor: 1000, asOfDate: "2026-11-01" }],
      adjustments: [],
      today: "2026-11-14",
      incomes: [income("UYU", 100000, "2026-01-05")],
      actualForMonth: byMonth([])
    });
    expect(balances).toEqual([{ currency: "USD", asOfDate: "2026-11-01", openingMinor: 1000, incomeMinor: 0, spentMinor: 0, adjustmentsMinor: 0, balanceMinor: 1000 }]);
  });

  it("walks every month from the opening date to today and sums data quality", () => {
    const seen: string[] = [];
    const { quality } = balanceByCurrency({
      openings: [{ currencyCode: "UYU", amountMinor: 0, asOfDate: "2026-09-20" }],
      adjustments: [],
      today: "2026-11-14",
      incomes: [],
      actualForMonth: (key) => {
        seen.push(key);
        return month([], { pending: 1, ambiguous: 2, omitted: 3 });
      }
    });
    expect(seen).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(quality).toEqual({ pending: 3, ambiguous: 6, omitted: 9 });
  });

  it("keeps the opening amount when the opening date is after today", () => {
    const { balances } = balanceByCurrency({
      openings: [{ currencyCode: "UYU", amountMinor: 700, asOfDate: "2026-11-20" }],
      adjustments: [],
      today: "2026-11-14",
      incomes: [income("UYU", 100000, "2026-01-01")],
      actualForMonth: byMonth([spend("2026-11-03", "UYU", 1)])
    });
    expect(balances[0]).toMatchObject({ incomeMinor: 0, spentMinor: 0, balanceMinor: 700 });
  });
});
