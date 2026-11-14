import type { CustomRecurrenceAnchor, CustomRecurrenceUnit, Frequency } from "@/src/db/repository";
import { dateOnly, monthBounds, parseDateOnly } from "./dates";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RecurrenceSchedule = {
  frequency: Frequency;
  customInterval?: number | null;
  customUnit?: CustomRecurrenceUnit | null;
  customAnchor?: CustomRecurrenceAnchor | null;
  customDayOfMonth?: number | null;
  customDayOfWeek?: number | null;
  startDate: string;
  endDate: string | null;
};

export function countOccurrencesInMonth(input: RecurrenceSchedule & { month: string }) {
  const { start, end } = monthBounds(input.month);
  return listOccurrences(input, dateOnly(start), dateOnly(end)).length;
}

/** Occurrence dates (YYYY-MM-DD, ascending) inside [from, to] and inside the schedule's start/end dates. */
export function listOccurrences(schedule: RecurrenceSchedule, from: string, to: string): string[] {
  const rangeStart = parseDateOnly(from);
  const rangeEnd = parseDateOnly(to);
  const start = parseDateOnly(schedule.startDate);
  const configuredEnd = schedule.endDate ? parseDateOnly(schedule.endDate) : null;
  const end = configuredEnd && configuredEnd < rangeEnd ? configuredEnd : rangeEnd;

  if (start > rangeEnd || end < rangeStart || end < start) {
    return [];
  }

  let dates: Date[];
  if (schedule.frequency === "custom") {
    dates = collectCustomOccurrences({
      start,
      end,
      rangeStart,
      interval: requireCustomNumber(schedule.customInterval, "custom interval"),
      unit: requireCustomValue(schedule.customUnit, "custom unit"),
      anchor: requireCustomValue(schedule.customAnchor, "custom anchor"),
      dayOfMonth: schedule.customDayOfMonth ?? null,
      dayOfWeek: schedule.customDayOfWeek ?? null
    });
  } else if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    dates = collectDayIntervalOccurrences(start, end, rangeStart, schedule.frequency === "weekly" ? 7 : 14);
  } else {
    const monthStep = schedule.frequency === "monthly" ? 1 : schedule.frequency === "quarterly" ? 3 : 12;
    dates = collectMonthIntervalOccurrences(start, end, rangeStart, monthStep);
  }

  return dates.map(dateOnly);
}

function collectCustomOccurrences(input: {
  start: Date;
  end: Date;
  rangeStart: Date;
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

    return collectDayIntervalOccurrences(
      firstWeekdayOnOrAfter(input.start, requireDayOfWeek(input.dayOfWeek)),
      input.end,
      input.rangeStart,
      input.interval * 7
    );
  }

  const monthStep = input.unit === "months" ? input.interval : input.interval * 12;

  if (input.anchor === "day_of_month") {
    return collectCustomMonthDayOccurrences(
      input.start,
      input.end,
      input.rangeStart,
      monthStep,
      requireDayOfMonth(input.dayOfMonth)
    );
  }

  return collectCustomMonthWeekdayOccurrences(
    input.start,
    input.end,
    input.rangeStart,
    monthStep,
    requireDayOfWeek(input.dayOfWeek)
  );
}

/** `end` is already clamped to both the schedule end and the range end. */
function collectDayIntervalOccurrences(start: Date, end: Date, rangeStart: Date, dayStep: number) {
  let occurrence = new Date(start);
  const dates: Date[] = [];

  if (occurrence < rangeStart) {
    const daysBeforeRange = Math.floor((rangeStart.getTime() - occurrence.getTime()) / DAY_MS);
    const intervalsToSkip = Math.floor(daysBeforeRange / dayStep);
    occurrence = new Date(occurrence.getTime() + intervalsToSkip * dayStep * DAY_MS);

    while (occurrence < rangeStart) {
      occurrence = new Date(occurrence.getTime() + dayStep * DAY_MS);
    }
  }

  while (occurrence <= end) {
    dates.push(occurrence);
    occurrence = new Date(occurrence.getTime() + dayStep * DAY_MS);
  }

  return dates;
}

function collectMonthIntervalOccurrences(start: Date, end: Date, rangeStart: Date, monthStep: number) {
  const dates: Date[] = [];
  let index = 0;
  let occurrence = occurrenceFromStart(start, index * monthStep);

  while (occurrence < rangeStart) {
    index += 1;
    occurrence = occurrenceFromStart(start, index * monthStep);
  }

  while (occurrence <= end) {
    dates.push(occurrence);
    index += 1;
    occurrence = occurrenceFromStart(start, index * monthStep);
  }

  return dates;
}

function occurrenceFromStart(start: Date, monthsFromStart: number) {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + monthsFromStart;
  const anchorDay = start.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay)));
}

function collectCustomMonthDayOccurrences(start: Date, end: Date, rangeStart: Date, monthStep: number, dayOfMonth: number) {
  const dates: Date[] = [];

  for (let monthIndex = firstEligibleMonthIndex(start, rangeStart, monthStep); monthIndex <= monthIndexFromDate(end); monthIndex += monthStep) {
    const occurrence = occurrenceFromMonthIndex(monthIndex, dayOfMonth);

    if (occurrence >= start && occurrence >= rangeStart && occurrence <= end) {
      dates.push(occurrence);
    }
  }

  return dates;
}

function collectCustomMonthWeekdayOccurrences(start: Date, end: Date, rangeStart: Date, monthStep: number, dayOfWeek: number) {
  const dates: Date[] = [];

  for (let monthIndex = firstEligibleMonthIndex(start, rangeStart, monthStep); monthIndex <= monthIndexFromDate(end); monthIndex += monthStep) {
    const { start: selectedMonthStart, end: selectedMonthEnd } = monthBoundsFromIndex(monthIndex);
    let occurrence = firstWeekdayOnOrAfter(selectedMonthStart, dayOfWeek);

    while (occurrence <= selectedMonthEnd) {
      if (occurrence >= start && occurrence >= rangeStart && occurrence <= end) {
        dates.push(occurrence);
      }

      occurrence = new Date(occurrence.getTime() + 7 * DAY_MS);
    }
  }

  return dates;
}

function firstEligibleMonthIndex(start: Date, rangeStart: Date, monthStep: number) {
  const startIndex = monthIndexFromDate(start);
  const targetIndex = monthIndexFromDate(rangeStart);

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
