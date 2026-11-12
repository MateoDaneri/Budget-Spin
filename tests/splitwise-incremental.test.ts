import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/src/db/client";
import { listCategories } from "@/src/db/repository";
import { getSplitwiseSnapshot } from "@/src/splitwise/client";
import { getSplitwiseSyncState, listSplitwiseImports, saveSplitwiseSnapshot, setSplitwiseCategory } from "@/src/splitwise/store";
import { FULL_RECONCILIATION_MS, planSplitwiseSync, syncSplitwise } from "@/src/splitwise/sync";

// Synthetic provider: filters by updated_after/updated_before and pages by offset/limit like the documented parameters.
type Raw = { id: number; date: string; description: string; cost: string; currency_code: string; payment: boolean; deleted_at: string | null; updated_at: string; users: Array<{ user_id: number; paid_share: string; owed_share: string }> };
const ACCOUNT = 42;
const raw = (id: number, updatedAt: string, extra: Partial<Raw> = {}): Raw => ({
  id, date: "2026-01-15T00:00:00Z", description: `Synthetic ${id}`, cost: "20.00", currency_code: "USD", payment: false,
  deleted_at: null, updated_at: updatedAt, users: [{ user_id: ACCOUNT, paid_share: "20.00", owed_share: "10.00" }], ...extra
});

let dbPath: string;
let clock: number;
let data: Map<number, Raw>;
let expenseCalls: URL[];
let failAtOffset: number | null;
let msPerPage: number;
const now = () => clock;

const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("get_current_user")) return Response.json({ user: { id: ACCOUNT } });
  if (url.pathname.endsWith("get_friends")) return Response.json({ friends: [] });
  if (url.pathname.endsWith("get_notifications")) return Response.json({ notifications: [] });
  expenseCalls.push(url);
  clock += msPerPage;
  const offset = Number(url.searchParams.get("offset"));
  if (failAtOffset !== null && offset >= failAtOffset) return new Response("synthetic upstream failure", { status: 429 });
  const limit = Number(url.searchParams.get("limit"));
  const after = url.searchParams.get("updated_after");
  const before = url.searchParams.get("updated_before");
  const rows = [...data.values()]
    .filter((row) => (!after || Date.parse(row.updated_at) > Date.parse(after)) && (!before || Date.parse(row.updated_at) <= Date.parse(before)))
    .sort((a, b) => a.id - b.id);
  return Response.json({ expenses: rows.slice(offset, offset + limit) });
};
const run = () => syncSplitwise({ fetcher, now });
const stored = (id: number) => listSplitwiseImports(10000).expenses.find((row) => row.id === id);

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `splitwise-incremental-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  process.env.SPLITWISE_API_KEY = "synthetic-splitwise-key";
  closeDb();
  clock = Date.parse("2026-03-01T12:00:00Z");
  data = new Map();
  expenseCalls = [];
  failAtOffset = null;
  msPerPage = 0;
});
afterEach(() => {
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(dbPath + suffix, { force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.SPLITWISE_API_KEY;
  vi.restoreAllMocks();
});

describe("incremental Splitwise sync", () => {
  it("syncs more than 2,000 expenses across pages without an item ceiling", async () => {
    for (let id = 1; id <= 2050; id++) data.set(id, raw(id, new Date(Date.parse("2026-02-01T00:00:00Z") + id * 1000).toISOString().replace(".000Z", "Z")));
    await run();
    expect(listSplitwiseImports(10000).expenses).toHaveLength(2050);
    expect(expenseCalls).toHaveLength(103);
    expect(expenseCalls.every((url) => !url.searchParams.has("updated_after"))).toBe(true);
    expect(getSplitwiseSyncState()).toMatchObject({ watermark: "2026-02-01T00:34:10.000Z", fullSyncedAt: new Date(clock).toISOString() });
  });

  it("sends the watermark minus the overlap and upserts only returned rows, keeping the owner's category", async () => {
    data.set(1, raw(1, "2026-02-01T10:00:00Z"));
    data.set(2, raw(2, "2026-02-01T09:00:00Z"));
    await run();
    const food = listCategories("expense").find((category) => category.name === "Food")!;
    setSplitwiseCategory(1, food.id);

    clock += 60 * 60 * 1000;
    expenseCalls = [];
    data.set(1, raw(1, "2026-03-01T12:30:00Z", { users: [{ user_id: ACCOUNT, paid_share: "20.00", owed_share: "12.00" }] }));
    data.set(2, { ...raw(2, "2026-02-01T09:00:00Z"), description: "Changed without an update stamp" });
    data.set(3, raw(3, "2026-03-01T12:40:00Z"));
    await run();

    expect(expenseCalls).toHaveLength(1);
    expect(expenseCalls[0].searchParams.get("updated_after")).toBe("2026-02-01T09:55:00Z");
    expect(expenseCalls[0].searchParams.get("updated_before")).toBe("2026-03-01T13:00:00Z");
    expect(stored(1)).toMatchObject({ owed: "12.00", categoryId: food.id });
    expect(stored(2)?.description).toBe("Synthetic 2");
    expect(stored(3)).toBeDefined();
    expect(getSplitwiseSyncState()?.watermark).toBe("2026-03-01T12:40:00.000Z");
  });

  it("stores a deleted expense returned by an incremental run as deleted", async () => {
    data.set(1, raw(1, "2026-02-01T10:00:00Z"));
    await run();
    clock += 60 * 60 * 1000;
    data.set(1, raw(1, "2026-03-01T12:10:00Z", { deleted_at: "2026-03-01T12:10:00Z" }));
    await run();
    expect(stored(1)?.deleted).toBe(true);
  });

  it("neither writes nor advances the watermark when a later page fails", async () => {
    data.set(1, raw(1, "2026-02-01T10:00:00Z"));
    await run();
    const before = getSplitwiseSyncState();
    clock += 60 * 60 * 1000;
    for (let id = 100; id < 145; id++) data.set(id, raw(id, "2026-03-01T12:20:00Z"));
    data.set(1, raw(1, "2026-03-01T12:20:00Z", { description: "Edited" }));
    failAtOffset = 20;
    await expect(run()).rejects.toMatchObject({ kind: "rate-limit" });
    expect(getSplitwiseSyncState()).toEqual(before);
    expect(listSplitwiseImports(10000).expenses).toHaveLength(1);
    expect(stored(1)?.description).toBe("Synthetic 1");
  });

  it("runs a full pass when the watermark is missing and a full reconciliation when the last full pass is stale", async () => {
    data.set(1, raw(1, "2026-02-01T10:00:00Z"));
    // A database written before this change has an account row but no watermark.
    saveSplitwiseSnapshot(ACCOUNT, []);
    expect(getSplitwiseSyncState()?.watermark).toBeNull();
    await run();
    expect(expenseCalls[0].searchParams.has("updated_after")).toBe(false);
    const firstFull = getSplitwiseSyncState()?.fullSyncedAt;
    expect(firstFull).toBe(new Date(clock).toISOString());

    clock += 60 * 60 * 1000;
    expenseCalls = [];
    await run();
    expect(expenseCalls[0].searchParams.has("updated_after")).toBe(true);
    expect(getSplitwiseSyncState()?.fullSyncedAt).toBe(firstFull);

    clock = Date.parse(firstFull!) + FULL_RECONCILIATION_MS;
    expenseCalls = [];
    await run();
    expect(expenseCalls[0].searchParams.has("updated_after")).toBe(false);
    expect(getSplitwiseSyncState()?.fullSyncedAt).toBe(new Date(clock).toISOString());
  });

  it("plans a full pass for no state, a missing watermark or an unreadable timestamp", () => {
    const at = Date.parse("2026-03-01T00:00:00Z");
    const state = { accountId: ACCOUNT, syncedAt: "2026-03-01T00:00:00.000Z", watermark: "2026-02-28T00:00:00.000Z", fullSyncedAt: "2026-02-27T00:00:00.000Z" };
    expect(planSplitwiseSync(null, at)).toEqual({ mode: "full" });
    expect(planSplitwiseSync({ ...state, watermark: null }, at)).toEqual({ mode: "full" });
    expect(planSplitwiseSync({ ...state, fullSyncedAt: null }, at)).toEqual({ mode: "full" });
    expect(planSplitwiseSync({ ...state, watermark: "not a time" }, at)).toEqual({ mode: "full" });
    expect(planSplitwiseSync(state, at)).toEqual({ mode: "incremental", updatedAfter: "2026-02-27T23:55:00Z" });
  });

  it("stops with an explicit error when the time budget is exceeded and keeps the watermark", async () => {
    data.set(1, raw(1, "2026-02-01T10:00:00Z"));
    await run();
    const before = getSplitwiseSyncState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    clock += 60 * 60 * 1000;
    for (let id = 100; id < 300; id++) data.set(id, raw(id, "2026-03-01T12:20:00Z"));
    msPerPage = 2 * 60 * 1000;
    await expect(run()).rejects.toMatchObject({ reason: "time-budget" });
    expect(getSplitwiseSyncState()).toEqual(before);
    expect(listSplitwiseImports(10000).expenses).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("time-budget"));
  });

  it("stops with an explicit error at the page cap instead of truncating", async () => {
    for (let id = 1; id <= 60; id++) data.set(id, raw(id, "2026-02-01T10:00:00Z"));
    await expect(getSplitwiseSnapshot("synthetic", fetcher, { now, maxPages: 2 })).rejects.toMatchObject({ reason: "page-cap" });
    expect(listSplitwiseImports(10000).expenses).toEqual([]);
  });
});
