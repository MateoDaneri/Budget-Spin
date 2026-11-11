import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import { saveSplitwiseSnapshot } from "@/src/splitwise/store";
import { listSplitwiseActivity, saveSplitwiseActivity } from "@/src/splitwise/activity-store";
import { getSplitwiseActivityAndBalances } from "@/src/splitwise/client";

let dbPath: string;
beforeEach(() => { dbPath = path.join(os.tmpdir(), `activity-${crypto.randomUUID()}.sqlite`); process.env.DATABASE_PATH = dbPath; closeDb(); });
afterEach(() => { closeDb(); for (const s of ["", "-shm", "-wal"]) fs.rmSync(dbPath + s, { force: true }); delete process.env.DATABASE_PATH; });
const expense = { id: 4, date: "2026-01-01T00:00:00Z", description: "Synthetic", currency: "USD", total: "20.00", paid: "20.00", owed: "8.00", payment: false, deleted: false };
const balance = { friendId: 7, person: "Example", currency: "USD", amount: "-8.00" };
const event = { id: 20, type: 1 as const, occurredAt: "2026-01-02T00:00:00Z", expenseId: 4, actorId: 7 };

describe("Splitwise observable history", () => {
  it("records observations only from collection onward and filters events to this user's imports", () => {
    saveSplitwiseSnapshot(42, [expense]);
    expect(listSplitwiseActivity().observations).toEqual([]);
    saveSplitwiseActivity(42, [balance], [event, { ...event, id: 21, expenseId: 999 }], "2026-02-01T00:00:00Z");
    saveSplitwiseActivity(42, [{ ...balance, amount: "-4.00" }], [event], "2026-02-02T00:00:00Z");
    const result = listSplitwiseActivity();
    expect(result.observations.map((x) => x.amount)).toEqual(["-4.00", "-8.00"]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ id: 20, description: "Synthetic", actorId: 7, type: 1 });
    expect(result.firstObservedAt).toBe("2026-02-01T00:00:00Z");
  });
  it("refuses to mix account histories", () => {
    saveSplitwiseSnapshot(42, [expense]);
    expect(() => saveSplitwiseActivity(43, [balance], [event])).toThrow("account mismatch");
    expect(listSplitwiseActivity().observations).toEqual([]);
  });
  it("stores different people and currencies independently without adding them", () => {
    saveSplitwiseSnapshot(42, [expense]);
    saveSplitwiseActivity(42, [balance, { ...balance, currency: "UYU", amount: "50.00" }, { ...balance, friendId: 8, person: "Other", amount: "10.00" }], [], "2026-02-01T00:00:00Z");
    const rows = listSplitwiseActivity().observations;
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ friendId: 7, currency: "USD", amount: "-8.00" }), expect.objectContaining({ friendId: 7, currency: "UYU", amount: "50.00" }), expect.objectContaining({ friendId: 8, currency: "USD", amount: "10.00" })]));
  });
  it("uses provider notification type and stable identifiers, never HTML content", async () => {
    const fetcher: typeof fetch = async (url) => String(url).includes("get_friends")
      ? Response.json({ friends: [{ id: 7, first_name: "Example", last_name: null, balance: [{ currency_code: "USD", amount: "-8.00" }] }] })
      : Response.json({ notifications: [{ id: 20, type: 1, created_at: event.occurredAt, created_by: 7, source: { type: "Expense", id: 4 }, content: "<script>secret</script>" }, { id: 21, type: 3 }] });
    const result = await getSplitwiseActivityAndBalances("synthetic", fetcher);
    expect(result).toEqual({ balances: [balance], events: [event] });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
