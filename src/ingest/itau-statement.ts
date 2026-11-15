/** Only summary fields leave this parser; PDF and individual lines stay in memory. */
export type StatementText = { x: number; y: number; str: string };
export type StatementSummary = {
  issuedOn: string;
  dueDate: string;
  totalUyuMinor: number | null;
  totalUsdMinor: number | null;
};
const SENDER = /^[^@\s<>]+@itau\.com\.uy$/i;
export function isItauStatement(input: {
  from: string;
  subject: string;
}): boolean {
  return (
    SENDER.test(input.from.trim()) &&
    /^env[ií]o de estado de cuenta visa ita[uú]$/i.test(input.subject.trim())
  );
}
function iso(day: string, month: string, year: string): string | null {
  const y = Number(year.length === 2 ? `20${year}` : year),
    m = Number(month),
    d = Number(day),
    date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 &&
    y <= 2100 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;
}
function dates(text: string): string[] {
  return [...text.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/g)]
    .map((m) => iso(m[1], m[2], m[3]))
    .filter((x): x is string => x !== null);
}
function amount(text: string): number | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- Bounded digit groups separated by punctuation.
  if (!/^-?(?:\d{1,3}(?:\.\d{3}){0,4}|\d{1,12}),\d{2}$/.test(text)) return null;
  const n = Number(text.replace(/[-.,]/g, ""));
  return Number.isSafeInteger(n) ? (text.startsWith("-") ? -n : n) : null;
}
function rows(page: StatementText[]): StatementText[][] {
  const result: StatementText[][] = [];
  for (const item of page
    .filter((x) => x.str.trim())
    .sort((a, b) => b.y - a.y)) {
    const row = result.at(-1);
    if (row && Math.abs(row[0].y - item.y) <= 3) row.push(item);
    else result.push([item]);
  }
  return result.map((row) => row.sort((a, b) => a.x - b.x));
}
function at(page: StatementText[], x: number, y: number): string | null {
  const found = page
    .filter((item) => Math.abs(item.x - x) <= 3 && Math.abs(item.y - y) <= 3)
    .flatMap((item) => dates(item.str));
  return found.length === 1 ? found[0] : null;
}
/** Fixed template is accepted only with independent anchors and repeated due date. */
export function parseStatementItems(
  pages: StatementText[][],
): StatementSummary | null {
  if (!pages.length || pages.length > 12) return null;
  const first = pages[0],
    issuedOn = at(first, 491, 727),
    dueDate = at(first, 132, 690),
    nextDue = at(first, 206, 690),
    repeatedDue = at(first, 275, 674);
  let priorAnchor = false;
  const totals: Array<{ uyu: number | null; usd: number | null }> = [];
  for (const page of pages)
    for (const row of rows(page)) {
      const text = row
        .map((x) => x.str.trim())
        .join(" ")
        .replace(/\s+/g, " ");
      if (/^saldo del estado de cuenta anterior\b/i.test(text))
        priorAnchor = true;
      if (/^saldo\s+contado\b/i.test(text)) {
        const found = row.flatMap((x) => {
          const value = amount(x.str.trim());
          return value === null || x.x < 420
            ? []
            : [{ currency: x.x >= 480 ? "usd" : "uyu", value }];
        });
        if (
          found.filter((x) => x.currency === "uyu").length > 1 ||
          found.filter((x) => x.currency === "usd").length > 1
        )
          return null;
        totals.push({
          uyu: found.find((x) => x.currency === "uyu")?.value ?? null,
          usd: found.find((x) => x.currency === "usd")?.value ?? null,
        });
      }
    }
  if (
    !issuedOn ||
    !dueDate ||
    !nextDue ||
    dueDate !== repeatedDue ||
    !priorAnchor ||
    totals.length !== 1
  )
    return null;
  const days = (a: string, b: string) =>
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
  if (days(dueDate, nextDue) < 20 || days(dueDate, nextDue) > 45) return null;
  const summary = {
    issuedOn,
    dueDate,
    totalUyuMinor: totals[0].uyu,
    totalUsdMinor: totals[0].usd,
  };
  return validStatementSummary(summary) ? summary : null;
}
export function validStatementSummary(
  value: unknown,
): value is StatementSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<StatementSummary>;
  const validDate = (v: unknown): v is string => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  if (!validDate(s.issuedOn) || !validDate(s.dueDate)) return false;
  const days =
    (Date.parse(`${s.dueDate}T00:00:00Z`) -
      Date.parse(`${s.issuedOn}T00:00:00Z`)) /
    86400000;
  if (days < 0 || days > 90) return false;
  const ok = (x: unknown) =>
    x === null ||
    (typeof x === "number" &&
      Number.isSafeInteger(x) &&
      Math.abs(x) <= 100000000000000);
  return (
    ok(s.totalUyuMinor) &&
    ok(s.totalUsdMinor) &&
    (s.totalUyuMinor !== null || s.totalUsdMinor !== null)
  );
}
