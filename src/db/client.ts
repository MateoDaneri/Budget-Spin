import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let cachedDb: DatabaseSync | null = null;
let cachedPath: string | null = null;

export function databasePath() {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "budgetspin.sqlite");
}

export function getDb() {
  const dbPath = databasePath();

  if (cachedDb && cachedPath === dbPath) {
    return cachedDb;
  }

  if (cachedDb) {
    cachedDb.close();
  }

  if (dbPath !== ":memory:") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from DATABASE_PATH (operator-controlled env var) or a constant default, never from request input
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  cachedDb = new DatabaseSync(dbPath);
  cachedPath = dbPath;
  cachedDb.exec("PRAGMA foreign_keys = ON;");
  cachedDb.exec("PRAGMA journal_mode = WAL;");

  return cachedDb;
}

export function closeDb() {
  if (cachedDb) {
    cachedDb.close();
  }

  cachedDb = null;
  cachedPath = null;
}
