import { describe, expect, it } from "vitest";
import { countOccurrencesInMonth, listOccurrences, type RecurrenceSchedule } from "@/src/finance/recurrence";

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

describe("listOccurrences", () => {
  it("clamps a month-end anchor to shorter months", () => {
    expect(listOccurrences({ frequency: "monthly", startDate: "2026-01-31", endDate: null }, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30"
    ]);
  });

  it("lists weekly dates inside the range", () => {
    const dates = listOccurrences({ frequency: "weekly", startDate: "2026-11-02", endDate: null }, "2026-11-01", "2026-11-30");
    expect(dates).toHaveLength(5);
    expect(dates[0]).toBe("2026-11-02");
  });

  it("stops at the end date", () => {
    expect(listOccurrences({ frequency: "monthly", startDate: "2026-01-20", endDate: "2026-11-15" }, "2026-11-01", "2026-11-30")).toEqual([]);
    expect(listOccurrences({ frequency: "monthly", startDate: "2026-01-10", endDate: "2026-11-15" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-10"]);
  });

  it("lists custom day-of-month dates every two months", () => {
    expect(
      listOccurrences(
        { frequency: "custom", customInterval: 2, customUnit: "months", customAnchor: "day_of_month", customDayOfMonth: 15, startDate: "2026-01-01", endDate: null },
        "2026-01-01",
        "2026-06-30"
      )
    ).toEqual(["2026-01-15", "2026-03-15", "2026-05-15"]);
  });

  it("agrees with the monthly count for every frequency", () => {
    const schedules: RecurrenceSchedule[] = [
      { frequency: "weekly", startDate: "2026-02-02", endDate: null },
      { frequency: "biweekly", startDate: "2026-01-01", endDate: null },
      { frequency: "monthly", startDate: "2026-01-15", endDate: "2026-03-10" },
      { frequency: "quarterly", startDate: "2026-01-31", endDate: null },
      { frequency: "yearly", startDate: "2025-06-10", endDate: null },
      { frequency: "custom", customInterval: 3, customUnit: "weeks", customAnchor: "day_of_week", customDayOfWeek: 5, startDate: "2026-01-01", endDate: null },
      { frequency: "custom", customInterval: 1, customUnit: "months", customAnchor: "day_of_week", customDayOfWeek: 1, startDate: "2026-01-01", endDate: null },
      { frequency: "custom", customInterval: 1, customUnit: "years", customAnchor: "day_of_month", customDayOfMonth: 31, startDate: "2025-02-01", endDate: null }
    ];
    for (const schedule of schedules) {
      for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
        const month = `2026-${String(monthNumber).padStart(2, "0")}`;
        const last = new Date(Date.UTC(2026, monthNumber, 0)).toISOString().slice(0, 10);
        expect(listOccurrences(schedule, `${month}-01`, last)).toHaveLength(countOccurrencesInMonth({ ...schedule, month }));
      }
    }
  });
});
