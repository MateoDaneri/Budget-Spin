import { describe, expect, it } from "vitest";
import { comparePlanWithObserved, plannedExpenseByCurrency } from "@/src/finance/plan-vs-actual";

const expense = (values: Partial<Parameters<typeof plannedExpenseByCurrency>[1][number]> = {}) => ({
  currencyCode: "UYU",
  amountMinor: 100000,
  frequency: "monthly" as const,
  customInterval: null,
  customUnit: null,
  customAnchor: null,
  customDayOfMonth: null,
  customDayOfWeek: null,
  startDate: "2026-01-15",
  endDate: null,
  ...values
});

describe("plannedExpenseByCurrency", () => {
  it("sums active recurring expenses per original currency without converting", () => {
    const result = plannedExpenseByCurrency("2026-11", [
      expense(),
      expense({ amountMinor: 25050 }),
      expense({ currencyCode: "USD", amountMinor: 1999 }),
      expense({ frequency: "yearly", startDate: "2026-03-01" }),
      expense({ endDate: "2026-10-31" })
    ]);
    expect(result).toEqual([
      { currency: "USD", amountMinor: 1999 },
      { currency: "UYU", amountMinor: 125050 }
    ]);
  });

  it("multiplies by the number of occurrences in the month", () => {
    expect(plannedExpenseByCurrency("2026-11", [expense({ frequency: "weekly", startDate: "2026-11-02", amountMinor: 500 })])).toEqual([
      { currency: "UYU", amountMinor: 2500 }
    ]);
  });
});

describe("comparePlanWithObserved", () => {
  it("reports observed spending below the plan", () => {
    expect(comparePlanWithObserved([{ currency: "UYU", amountMinor: 100000 }], [{ currency: "UYU", amountMinor: 25000 }])).toEqual([
      { currency: "UYU", plannedMinor: 100000, observedMinor: 25000, differenceMinor: -75000, status: "under", plannedPercent: 100, observedPercent: 25 }
    ]);
  });

  it("reports observed spending above the plan, scaled to the observed amount", () => {
    expect(comparePlanWithObserved([{ currency: "UYU", amountMinor: 80000 }], [{ currency: "UYU", amountMinor: 100000 }])).toEqual([
      { currency: "UYU", plannedMinor: 80000, observedMinor: 100000, differenceMinor: 20000, status: "over", plannedPercent: 80, observedPercent: 100 }
    ]);
  });

  it("reports exactly on plan", () => {
    expect(comparePlanWithObserved([{ currency: "USD", amountMinor: 1000 }], [{ currency: "USD", amountMinor: 1000 }])[0]).toMatchObject({ status: "on-plan", differenceMinor: 0 });
  });

  it("marks a currency without a plan and does not invent a difference", () => {
    expect(comparePlanWithObserved([], [{ currency: "EUR", amountMinor: 4200 }])).toEqual([
      { currency: "EUR", plannedMinor: null, observedMinor: 4200, differenceMinor: null, status: "no-plan", plannedPercent: 0, observedPercent: 100 }
    ]);
  });

  it("treats a zero plan as a real plan that any spending exceeds", () => {
    expect(comparePlanWithObserved([{ currency: "UYU", amountMinor: 0 }], [{ currency: "UYU", amountMinor: 500 }])[0]).toMatchObject({
      plannedMinor: 0, differenceMinor: 500, status: "over", plannedPercent: 0, observedPercent: 100
    });
    expect(comparePlanWithObserved([{ currency: "UYU", amountMinor: 0 }], [])[0]).toMatchObject({
      plannedMinor: 0, observedMinor: 0, status: "on-plan", plannedPercent: 0, observedPercent: 0
    });
  });

  it("keeps several currencies separate and sorted, including planned-only ones", () => {
    const result = comparePlanWithObserved(
      [{ currency: "UYU", amountMinor: 200000 }, { currency: "USD", amountMinor: 5000 }],
      [{ currency: "USD", amountMinor: 7500 }, { currency: "EUR", amountMinor: 300 }]
    );
    expect(result.map((row) => [row.currency, row.status, row.differenceMinor])).toEqual([
      ["EUR", "no-plan", null],
      ["USD", "over", 2500],
      ["UYU", "under", -200000]
    ]);
    expect(result[2]).toMatchObject({ observedMinor: 0, observedPercent: 0, plannedPercent: 100 });
  });

  it("rejects non-integer money", () => {
    expect(() => comparePlanWithObserved([{ currency: "UYU", amountMinor: 10.5 }], [])).toThrow(RangeError);
  });
});
