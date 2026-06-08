import type { CustomRecurrenceAnchor, CustomRecurrenceUnit, Frequency } from "@/src/db/repository";
import { monthBounds, parseDateOnly } from "./dates";

const DAY_MS = 24 * 60 * 60 * 1000;

export function countOccurrencesInMonth(input: {
  frequency: Frequency;
  customInterval?: number | null;
  customUnit?: CustomRecurrenceUnit | null;
  customAnchor?: CustomRecurrenceAnchor | null;
  customDayOfMonth?: number | null;
  customDayOfWeek?: number | null;
  startDate: string;
  endDate: string | null;
  month: string;
}) {
  const { start: monthStart, end: monthEnd } = monthBounds(input.month);
  const start = parseDateOnly(input.startDate);
  const configuredEnd = input.endDate ? parseDateOnly(input.endDate) : null;
  const end = configuredEnd && configuredEnd < monthEnd ? configuredEnd : monthEnd;

  if (start > monthEnd || end < monthStart) {
    return 0;
  }

  if (input.frequency === "custom") {
    return countCustomOccurrencesInMonth({
      start,
      end,
      monthStart,
      monthEnd,
      interval: requireCustomNumber(input.customInterval, "custom interval"),
      unit: requireCustomValue(input.customUnit, "custom unit"),
      anchor: requireCustomValue(input.customAnchor, "custom anchor"),
      dayOfMonth: input.customDayOfMonth ?? null,
      dayOfWeek: input.customDayOfWeek ?? null
    });
  }

  if (input.frequency === "weekly" || input.frequency === "biweekly") {
    return countDayIntervalOccurrences(start, end, monthStart, input.frequency === "weekly" ? 7 : 14);
  }

  const monthStep = input.frequency === "monthly" ? 1 : input.frequency === "quarterly" ? 3 : 12;
  return countMonthIntervalOccurrences(start, end, monthStart, monthEnd, monthStep);
}

function countCustomOccurrencesInMonth(input: {
  start: Date;
  end: Date;
  monthStart: Date;
  monthEnd: Date;
  interval: number;
  unit: CustomRecurrenceUnit;
  anchor: CustomRecurrenceAnchor;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
}) {
  if (input.unit === "weeks") {
    if (input.anchor !== "day_of_week") {
      throw new Error("Custom weekly recurrence requires a day of week.");
    }

    return countDayIntervalOccurrences(
      firstWeekdayOnOrAfter(input.start, requireDayOfWeek(input.dayOfWeek)),
      input.end,
      input.monthStart,
      input.interval * 7
    );
  }

  const monthStep = input.unit === "months" ? input.interval : input.interval * 12;

  if (input.anchor === "day_of_month") {
    return countCustomMonthDayOccurrences(
      input.start,
      input.end,
      input.monthStart,
      input.monthEnd,
      monthStep,
      requireDayOfMonth(input.dayOfMonth)
    );
  }

  return countCustomMonthWeekdayOccurrences(
    input.start,
    input.end,
    input.monthStart,
    input.monthEnd,
    monthStep,
    requireDayOfWeek(input.dayOfWeek)
  );
}

function countDayIntervalOccurrences(start: Date, end: Date, monthStart: Date, dayStep: number) {
  let occurrence = new Date(start);
  let count = 0;

  if (occurrence < monthStart) {
    const daysBeforeMonth = Math.floor((monthStart.getTime() - occurrence.getTime()) / DAY_MS);
    const intervalsToSkip = Math.floor(daysBeforeMonth / dayStep);
    occurrence = new Date(occurrence.getTime() + intervalsToSkip * dayStep * DAY_MS);

    while (occurrence < monthStart) {
      occurrence = new Date(occurrence.getTime() + dayStep * DAY_MS);
    }
  }

  while (occurrence <= end) {
    count += 1;
    occurrence = new Date(occurrence.getTime() + dayStep * DAY_MS);
  }

  return count;
}

function countMonthIntervalOccurrences(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date,
  monthStep: number
) {
  let count = 0;
  let index = 0;
  let occurrence = occurrenceFromStart(start, index * monthStep);

  while (occurrence < monthStart) {
    index += 1;
    occurrence = occurrenceFromStart(start, index * monthStep);
  }

  while (occurrence <= monthEnd && occurrence <= end) {
    count += 1;
    index += 1;
    occurrence = occurrenceFromStart(start, index * monthStep);
  }

  return count;
}

function occurrenceFromStart(start: Date, monthsFromStart: number) {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + monthsFromStart;
  const anchorDay = start.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay)));
}

function countCustomMonthDayOccurrences(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date,
  monthStep: number,
  dayOfMonth: number
) {
  let count = 0;

  for (let monthIndex = firstEligibleMonthIndex(start, monthStart, monthStep); monthIndex <= monthIndexFromDate(monthEnd); monthIndex += monthStep) {
    const occurrence = occurrenceFromMonthIndex(monthIndex, dayOfMonth);

    if (occurrence >= start && occurrence >= monthStart && occurrence <= monthEnd && occurrence <= end) {
      count += 1;
    }
  }

  return count;
}

function countCustomMonthWeekdayOccurrences(
  start: Date,
  end: Date,
  monthStart: Date,
  monthEnd: Date,
  monthStep: number,
  dayOfWeek: number
) {
  let count = 0;

  for (let monthIndex = firstEligibleMonthIndex(start, monthStart, monthStep); monthIndex <= monthIndexFromDate(monthEnd); monthIndex += monthStep) {
    const { start: selectedMonthStart, end: selectedMonthEnd } = monthBoundsFromIndex(monthIndex);
    let occurrence = firstWeekdayOnOrAfter(selectedMonthStart, dayOfWeek);

    while (occurrence <= selectedMonthEnd) {
      if (occurrence >= start && occurrence >= monthStart && occurrence <= monthEnd && occurrence <= end) {
        count += 1;
      }

      occurrence = new Date(occurrence.getTime() + 7 * DAY_MS);
    }
  }

  return count;
}

function firstEligibleMonthIndex(start: Date, monthStart: Date, monthStep: number) {
  const startIndex = monthIndexFromDate(start);
  const targetIndex = monthIndexFromDate(monthStart);

  if (targetIndex <= startIndex) {
    return startIndex;
  }

  const monthsAfterStart = targetIndex - startIndex;
  const remainder = monthsAfterStart % monthStep;
  return remainder === 0 ? targetIndex : targetIndex + (monthStep - remainder);
}

function monthIndexFromDate(date: Date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function occurrenceFromMonthIndex(monthIndex: number, dayOfMonth: number) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay)));
}

function monthBoundsFromIndex(monthIndex: number) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0))
  };
}

function firstWeekdayOnOrAfter(date: Date, dayOfWeek: number) {
  const daysToAdd = (dayOfWeek - date.getUTCDay() + 7) % 7;
  return new Date(date.getTime() + daysToAdd * DAY_MS);
}

function requireCustomNumber(value: number | null | undefined, label: string) {
  if (!value || value <= 0) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function requireCustomValue<T>(value: T | null | undefined, label: string) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function requireDayOfMonth(value: number | null) {
  if (!value || value < 1 || value > 31) {
    throw new Error("Custom day of month must be between 1 and 31.");
  }

  return value;
}

function requireDayOfWeek(value: number | null) {
  if (value === null || value < 0 || value > 6) {
    throw new Error("Custom day of week must be between Sunday and Saturday.");
  }

  return value;
}
