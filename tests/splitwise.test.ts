import { describe, expect, it, vi } from "vitest";
import { getSplitwiseBalances, getSplitwiseExpenses } from "@/src/splitwise/client";

const expense = { id: 10, date: "2026-06-22T12:00:00Z", description: "Lunch", cost: "25.00", currency_code: "USD", payment: false, deleted_at: null, users: [{ user_id: 5, paid_share: "25.00", owed_share: "12.50" }, { user_id: 6, paid_share: "0.00", owed_share: "12.50" }] };
function mockFetch(...responses: Response[]): typeof fetch {
  return vi.fn().mockImplementation(async () => responses.shift()) as unknown as typeof fetch;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("Splitwise read-only client", () => {
  it("loads the authenticated user's share with bounded GET requests and no caching", async () => {
    const fetcher = mockFetch(json({ user: { id: 5 } }), json({ expenses: [expense] }));
    expect(await getSplitwiseExpenses("secret", fetcher)).toEqual([{ id: 10, date: expense.date, description: "Lunch", total: "25.00", currency: "USD", paid: "25.00", owed: "12.50", payment: false, deleted: false }]);
    const calls = vi.mocked(fetcher).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[1][0])).toBe("https://secure.splitwise.com/api/v3.0/get_expenses?limit=20");
    expect(calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer secret" } });
    expect(calls.every((call) => !call[1]?.method || call[1].method === "GET")).toBe(true);
  });
  it("returns separate signed balances by person and currency", async () => {
    const fetcher = mockFetch(json({ friends: [{ first_name: "Alex", last_name: "Test", balance: [{ currency_code: "USD", amount: "-4.50" }, { currency_code: "UYU", amount: "12.0" }] }] }));
    expect(await getSplitwiseBalances("secret", fetcher)).toEqual([{ person: "Alex Test", currency: "USD", amount: "-4.50" }, { person: "Alex Test", currency: "UYU", amount: "12.0" }]);
  });
  it("reports missing credentials without making a network request", async () => {
    const fetcher = mockFetch();
    await expect(getSplitwiseExpenses(undefined, fetcher)).rejects.toMatchObject({ kind: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports authorization failures and throttling without leaking response bodies", async () => {
    await expect(getSplitwiseExpenses("secret", mockFetch(json({ error: "secret" }, 401)))).rejects.toMatchObject({ kind: "unauthorized", message: "unauthorized" });
    await expect(getSplitwiseBalances("secret", mockFetch(json({}, 429)))).rejects.toMatchObject({ kind: "rate-limit" });
  });
  it("rejects malformed data and oversized responses", async () => {
    await expect(getSplitwiseExpenses("secret", mockFetch(json({ user: { id: 5 } }), json({ expenses: [{ ...expense, cost: "NaN" }] })))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(getSplitwiseBalances("secret", mockFetch(new Response("x".repeat(1024 * 1024 + 1))))).rejects.toMatchObject({ kind: "unavailable" });
  });
});
