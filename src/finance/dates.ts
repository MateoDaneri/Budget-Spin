export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function parseMonthKey(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month key: ${month}`);
  }

  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid month key: ${month}`);
  }

  return { year, monthIndex: monthNumber - 1 };
}

export function monthBounds(month: string) {
  const { year, monthIndex } = parseMonthKey(month);
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));

  return { start, end };
}

export function addMonths(month: string, offset: number) {
  // Pure month arithmetic: routing this through Date and local-time getters
  // shifts the result by one month in UTC-negative timezones.
  const { year, monthIndex } = parseMonthKey(month);
  const totalMonths = year * 12 + monthIndex + offset;
  const newYear = Math.floor(totalMonths / 12);
  const newMonthNumber = ((totalMonths % 12) + 12) % 12 + 1;
  return `${newYear}-${String(newMonthNumber).padStart(2, "0")}`;
}

export function trailingMonths(month: string, count: number) {
  return Array.from({ length: count }, (_, index) => addMonths(month, index - count + 1));
}

export function formatMonthLabel(month: string) {
  const { year, monthIndex } = parseMonthKey(month);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthIndex, 1))
  );
}

export function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
