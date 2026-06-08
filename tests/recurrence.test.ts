import { describe, expect, it } from "vitest";
import { countOccurrencesInMonth } from "@/src/finance/recurrence";

describe("countOccurrencesInMonth", () => {
  it("counts weekly occurrences across a short month", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "weekly",
        startDate: "2026-02-02",
        endDate: null,
        month: "2026-02"
      })
    ).toBe(4);
  });

  it("counts biweekly occurrences across a long month", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "biweekly",
        startDate: "2026-01-01",
        endDate: null,
        month: "2026-03"
      })
    ).toBe(2);
  });

  it("honors monthly start and end dates", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "monthly",
        startDate: "2026-01-15",
        endDate: "2026-03-10",
        month: "2026-03"
      })
    ).toBe(0);
  });

  it("counts yearly expenses only in matching months", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "yearly",
        startDate: "2026-05-10",
        endDate: null,
        month: "2027-05"
      })
    ).toBe(1);

    expect(
      countOccurrencesInMonth({
        frequency: "yearly",
        startDate: "2026-05-10",
        endDate: null,
        month: "2027-06"
      })
    ).toBe(0);
  });

  it("counts custom weekly occurrences every three weeks on a weekday", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "custom",
        customInterval: 3,
        customUnit: "weeks",
        customAnchor: "day_of_week",
        customDayOfWeek: 1,
        startDate: "2026-01-01",
        endDate: null,
        month: "2026-01"
      })
    ).toBe(2);
  });

  it("counts custom monthly day numbers and clamps long days", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "custom",
        customInterval: 1,
        customUnit: "months",
        customAnchor: "day_of_month",
        customDayOfMonth: 31,
        startDate: "2026-01-31",
        endDate: null,
        month: "2026-02"
      })
    ).toBe(1);
  });

  it("skips custom monthly intervals outside their cadence", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "custom",
        customInterval: 2,
        customUnit: "months",
        customAnchor: "day_of_month",
        customDayOfMonth: 10,
        startDate: "2026-01-10",
        endDate: null,
        month: "2026-02"
      })
    ).toBe(0);
  });

  it("counts custom monthly weekday occurrences in eligible months", () => {
    expect(
      countOccurrencesInMonth({
        frequency: "custom",
        customInterval: 1,
        customUnit: "months",
        customAnchor: "day_of_week",
        customDayOfWeek: 1,
        startDate: "2026-06-01",
        endDate: null,
        month: "2026-06"
      })
    ).toBe(5);
  });
});
