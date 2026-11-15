import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect } from "vitest";
import { closeDb } from "@/src/db/client";
import {
  insertCardStatement,
  listCardStatements,
  listTransactions,
} from "@/src/db/repository";
let db: string;
const summary = {
  issuedOn: "2026-01-01",
  dueDate: "2026-01-10",
  totalUyuMinor: 1234,
  totalUsdMinor: 0,
};
beforeEach(() => {
  db = path.join(os.tmpdir(), `statement-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = db;
  closeDb();
});
afterEach(() => {
  closeDb();
  for (const suffix of ["", "-shm", "-wal"])
    fs.rmSync(db + suffix, { force: true });
  delete process.env.DATABASE_PATH;
});
it("stores summaries idempotently, groups identical re-sends and never creates expenses", () => {
  expect(insertCardStatement("<one@example.test>", summary).inserted).toBe(
    true,
  );
  expect(insertCardStatement("<one@example.test>", summary).inserted).toBe(
    false,
  );
  expect(insertCardStatement("<two@example.test>", summary).inserted).toBe(
    true,
  );
  expect(listCardStatements()).toEqual([summary]);
  expect(listTransactions()).toEqual([]);
  expect(() =>
    insertCardStatement("<one@example.test>", {
      ...summary,
      totalUyuMinor: 999,
    }),
  ).toThrow();
  expect(() =>
    insertCardStatement("<three@example.test>", {
      ...summary,
      dueDate: "2026-02-31",
    }),
  ).toThrow();
});
