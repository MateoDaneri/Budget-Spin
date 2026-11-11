import "server-only";

const BASE = "https://secure.splitwise.com/api/v3.0/";
const MAX_RESPONSE_BYTES = 1024 * 1024;
export const EXPENSE_LIMIT = 20;
/** Safety net, not an item ceiling: 1,000 pages of 20 is far above the expected history. */
export const EXPENSE_PAGE_CAP = 1000;
/** Wall-clock budget for one expense pass; below the scheduler's 600 s trigger timeout. */
export const SYNC_TIME_BUDGET_MS = 5 * 60 * 1000;

export type SplitwiseExpense = {
  id: number;
  date: string;
  description: string;
  currency: string;
  total: string;
  paid: string | null;
  owed: string | null;
  payment: boolean;
  deleted: boolean;
};

export type SplitwiseBalance = { person: string; currency: string; amount: string };

export class SplitwiseError extends Error {
  constructor(public readonly kind: "unconfigured" | "unauthorized" | "rate-limit" | "unavailable") {
    super(kind);
  }
}

/** A pass stopped by its own bound; nothing from it is saved and the watermark stays put. */
export class SplitwiseSyncLimitError extends Error {
  constructor(public readonly reason: "time-budget" | "page-cap") {
    super(`splitwise-sync-${reason}`);
  }
}

/** Provider timestamps are sent at second precision, as in the API documentation examples. */
export function splitwiseTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SplitwiseError("unavailable");
  return value as Record<string, unknown>;
}
function money(value: unknown, allowNegative = false): string {
  const candidate = typeof value === "string" && allowNegative && value.startsWith("-") ? value.slice(1) : value;
  if (typeof candidate !== "string" || !(/^\d{1,15}$/.test(candidate) || /^\d{1,15}\.\d{1,2}$/.test(candidate))) throw new SplitwiseError("unavailable");
  return value as string;
}

async function getJson(path: "get_current_user" | "get_expenses" | "get_friends" | "get_notifications", token: string, fetcher: typeof fetch, page?: { limit: number; offset: number; before: string; after?: string }): Promise<Record<string, unknown>> {
  const url = new URL(path, BASE);
  if (path === "get_notifications") url.searchParams.set("limit", "100");
  if (path === "get_expenses") {
    url.searchParams.set("limit", String(page?.limit ?? EXPENSE_LIMIT));
    if (page) {
      url.searchParams.set("offset", String(page.offset));
      url.searchParams.set("updated_before", page.before);
      if (page.after) url.searchParams.set("updated_after", page.after);
    }
  }
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch {
    throw new SplitwiseError("unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new SplitwiseError("unauthorized");
  if (response.status === 429) throw new SplitwiseError("rate-limit");
  if (!response.ok || !response.body) throw new SplitwiseError("unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new SplitwiseError("unavailable"); }
      chunks.push(value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new SplitwiseError("unavailable");
  }
}

/** Returns only the fields shown in the UI, never the bearer token or raw response. */
export async function getSplitwiseExpenses(token: string | undefined, fetcher: typeof fetch = fetch): Promise<SplitwiseExpense[]> {
  if (!token?.trim()) throw new SplitwiseError("unconfigured");
  const current = object((await getJson("get_current_user", token, fetcher)).user);
  if (!Number.isSafeInteger(current.id) || (current.id as number) <= 0) throw new SplitwiseError("unavailable");
  const body = await getJson("get_expenses", token, fetcher);
  if (!Array.isArray(body.expenses) || body.expenses.length > EXPENSE_LIMIT) throw new SplitwiseError("unavailable");
  return parseExpenses(body.expenses, current.id as number);
}

function parseExpenses(expenses: unknown[], accountId: number): SplitwiseExpense[] {
  return expenses.map((value: unknown) => {
    const expense = object(value);
    if (!Number.isSafeInteger(expense.id) || (expense.id as number) <= 0 || typeof expense.date !== "string" || Number.isNaN(Date.parse(expense.date)) ||
        typeof expense.description !== "string" || typeof expense.currency_code !== "string" || !/^[A-Z]{3}$/.test(expense.currency_code) ||
        !Array.isArray(expense.users) || typeof expense.payment !== "boolean" || (expense.deleted_at !== null && typeof expense.deleted_at !== "string")) throw new SplitwiseError("unavailable");
    const matching = expense.users.map(object).filter((share) => share.user_id === accountId);
    if (matching.length > 1) throw new SplitwiseError("unavailable");
    return {
      id: expense.id as number, date: expense.date, description: expense.description,
      currency: expense.currency_code, total: money(expense.cost, true),
      paid: matching.length ? money(matching[0].paid_share, true) : null,
      owed: matching.length ? money(matching[0].owed_share, true) : null,
      payment: expense.payment, deleted: Boolean(expense.deleted_at)
    };
  });
}

export type SplitwiseSnapshotOptions = {
  /** Only expenses updated after this provider time; omitted for a full pass. */
  updatedAfter?: string;
  budgetMs?: number;
  maxPages?: number;
  now?: () => number;
};
export type SplitwiseSnapshot = {
  accountId: number;
  expenses: SplitwiseExpense[];
  /** Latest provider `updated_at` seen in this pass (ISO, UTC); undefined when none was returned. */
  watermark?: string;
};

/** Latest valid provider `updated_at` among raw expenses; rows without one do not move it. */
function latestUpdate(expenses: unknown[], current: number | undefined): number | undefined {
  let latest = current;
  for (const raw of expenses) {
    const updated = object(raw).updated_at;
    if (typeof updated !== "string") continue;
    const at = Date.parse(updated);
    if (!Number.isNaN(at) && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Read every expense updated in the window (all of them when `updatedAfter` is omitted).
 * The upper bound is fixed at the start so the result set can only shrink while paging.
 * There is no item ceiling; a time budget and a page cap stop runaway passes with an
 * explicit error. Nothing is returned (and so nothing is saved) unless the pass completes.
 */
export async function getSplitwiseSnapshot(token: string | undefined, fetcher: typeof fetch = fetch, options: SplitwiseSnapshotOptions = {}): Promise<SplitwiseSnapshot> {
  if (!token?.trim()) throw new SplitwiseError("unconfigured");
  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? SYNC_TIME_BUDGET_MS;
  const maxPages = options.maxPages ?? EXPENSE_PAGE_CAP;
  const started = now();
  const current = object((await getJson("get_current_user", token, fetcher)).user);
  if (!Number.isSafeInteger(current.id) || (current.id as number) <= 0) throw new SplitwiseError("unavailable");
  const accountId = current.id as number;
  const expenses: SplitwiseExpense[] = [];
  const seen = new Set<number>();
  const limit = EXPENSE_LIMIT;
  const before = splitwiseTime(started);
  let latest: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    if (now() - started > budgetMs) throw new SplitwiseSyncLimitError("time-budget");
    const body = await getJson("get_expenses", token, fetcher, { limit, offset: page * limit, before, after: options.updatedAfter });
    if (!Array.isArray(body.expenses) || body.expenses.length > limit) throw new SplitwiseError("unavailable");
    const parsed = parseExpenses(body.expenses, accountId);
    latest = latestUpdate(body.expenses, latest);
    for (const item of parsed) {
      if (seen.has(item.id)) throw new SplitwiseError("unavailable");
      seen.add(item.id); expenses.push(item);
    }
    if (parsed.length < limit) return { accountId, expenses, watermark: latest === undefined ? undefined : new Date(latest).toISOString() };
  }
  throw new SplitwiseSyncLimitError("page-cap");
}

/** Per-person amounts are shown as returned; no assumptions about aggregation. */
export async function getSplitwiseBalances(token: string | undefined, fetcher: typeof fetch = fetch): Promise<SplitwiseBalance[]> {
  if (!token?.trim()) throw new SplitwiseError("unconfigured");
  const body = await getJson("get_friends", token, fetcher);
  if (!Array.isArray(body.friends)) throw new SplitwiseError("unavailable");
  return body.friends.flatMap((value: unknown) => {
    const friend = object(value);
    if (typeof friend.first_name !== "string" || (friend.last_name !== null && typeof friend.last_name !== "string") || !Array.isArray(friend.balance)) throw new SplitwiseError("unavailable");
    const person = [friend.first_name, friend.last_name].filter(Boolean).join(" ");
    return friend.balance.map((raw: unknown) => {
      const balance = object(raw);
      if (typeof balance.currency_code !== "string" || !/^[A-Z]{3}$/.test(balance.currency_code) || typeof balance.amount !== "string") throw new SplitwiseError("unavailable");
      money(balance.amount.startsWith("-") ? balance.amount.slice(1) : balance.amount);
      return { person, currency: balance.currency_code, amount: balance.amount };
    });
  });
}

export type SplitwiseObservedBalance = SplitwiseBalance & { friendId: number };
export type SplitwiseActivity = { id: number; type: 0 | 1 | 2 | 13; occurredAt: string; expenseId: number; actorId: number | null };

/** Recent provider notifications and a current balance observation, never inferred history. */
export async function getSplitwiseActivityAndBalances(token: string | undefined, fetcher: typeof fetch = fetch): Promise<{ balances: SplitwiseObservedBalance[]; events: SplitwiseActivity[] }> {
  if (!token?.trim()) throw new SplitwiseError("unconfigured");
  const [friends, notifications] = await Promise.all([getJson("get_friends", token, fetcher), getJson("get_notifications", token, fetcher)]);
  if (!Array.isArray(friends.friends) || !Array.isArray(notifications.notifications) || notifications.notifications.length > 100) throw new SplitwiseError("unavailable");
  const balances: SplitwiseObservedBalance[] = friends.friends.flatMap((raw: unknown) => {
    const friend = object(raw);
    if (!Number.isSafeInteger(friend.id) || (friend.id as number) <= 0 || typeof friend.first_name !== "string" || (friend.last_name !== null && typeof friend.last_name !== "string") || !Array.isArray(friend.balance)) throw new SplitwiseError("unavailable");
    const person = [friend.first_name, friend.last_name].filter(Boolean).join(" ");
    return friend.balance.map((rawBalance: unknown) => {
      const balance = object(rawBalance);
      if (typeof balance.currency_code !== "string" || !/^[A-Z]{3}$/.test(balance.currency_code) || typeof balance.amount !== "string") throw new SplitwiseError("unavailable");
      money(balance.amount.startsWith("-") ? balance.amount.slice(1) : balance.amount);
      return { friendId: friend.id as number, person, currency: balance.currency_code, amount: balance.amount };
    });
  });
  if (new Set(balances.map((balance) => `${balance.friendId}:${balance.currency}`)).size !== balances.length) throw new SplitwiseError("unavailable");
  const events: SplitwiseActivity[] = [];
  for (const raw of notifications.notifications) {
    const n = object(raw);
    if (![0, 1, 2, 13].includes(n.type as number)) continue;
    if (!Number.isSafeInteger(n.id) || (n.id as number) <= 0 || typeof n.created_at !== "string" || Number.isNaN(Date.parse(n.created_at))) throw new SplitwiseError("unavailable");
    if (!n.source || typeof n.source !== "object" || Array.isArray(n.source)) continue;
    const source = object(n.source);
    if (source.type !== "Expense" || !Number.isSafeInteger(source.id) || (source.id as number) <= 0) continue;
    if (n.created_by !== null && n.created_by !== undefined && (!Number.isSafeInteger(n.created_by) || (n.created_by as number) <= 0)) throw new SplitwiseError("unavailable");
    events.push({ id: n.id as number, type: n.type as 0 | 1 | 2 | 13, occurredAt: n.created_at, expenseId: source.id as number, actorId: typeof n.created_by === "number" ? n.created_by : null });
  }
  return { balances, events };
}
