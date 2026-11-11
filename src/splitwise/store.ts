import { getDb } from "@/src/db/client";
import { automaticImportCategory, LOCAL_USER_ID, migrate, rememberImportCategory } from "@/src/db/repository";
import type { SplitwiseExpense } from "./client";

export type SplitwiseSyncState = { accountId: number; syncedAt: string; watermark: string | null; fullSyncedAt: string | null };

/** What the last committed passes left behind; null before the first successful sync. */
export function getSplitwiseSyncState(): SplitwiseSyncState | null {
  migrate();
  const row = getDb().prepare(`SELECT account_id AS accountId, synced_at AS syncedAt, updated_watermark AS watermark, full_synced_at AS fullSyncedAt
    FROM splitwise_sync_account WHERE singleton=1`).get() as SplitwiseSyncState | undefined;
  return row ?? null;
}

/** Pass metadata committed together with its rows; omitted, only `synced_at` moves. */
export type SplitwiseSyncCommit = { mode: "full" | "incremental"; startedAt: string; watermark?: string };

/**
 * Store only a completed pass. Missing records are retained, never guessed deleted.
 * The watermark is written in the same transaction as the rows and never moves backwards.
 */
export function saveSplitwiseSnapshot(accountId: number, expenses: SplitwiseExpense[], commit?: SplitwiseSyncCommit): void {
  migrate();
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT account_id FROM splitwise_sync_account WHERE singleton=1").get() as { account_id: number } | undefined;
    if (existing && existing.account_id !== accountId) throw new Error("Splitwise account changed; existing imports preserved.");
    const upsert = db.prepare(`INSERT INTO splitwise_imports
      (account_id, expense_id, txn_date, description, currency, total, paid, owed, payment, deleted, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, expense_id) DO UPDATE SET txn_date=excluded.txn_date,
      description=excluded.description, currency=excluded.currency, total=excluded.total,
      paid=excluded.paid, owed=excluded.owed, category_id=CASE WHEN excluded.payment=1 THEN NULL
        WHEN splitwise_imports.payment=1 THEN excluded.category_id ELSE splitwise_imports.category_id END,
      payment=excluded.payment, deleted=excluded.deleted`);
    for (const row of expenses) upsert.run(accountId, row.id, row.date, row.description, row.currency, row.total, row.paid, row.owed, Number(row.payment), Number(row.deleted), row.payment ? null : automaticImportCategory(row.description));
    // ISO strings from toISOString() share one format, so text comparison orders them by time.
    const watermark = commit?.watermark ? new Date(commit.watermark).toISOString() : null;
    db.prepare(`INSERT INTO splitwise_sync_account (singleton, account_id, synced_at, updated_watermark, full_synced_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET synced_at=excluded.synced_at,
      updated_watermark=CASE WHEN excluded.updated_watermark IS NULL THEN splitwise_sync_account.updated_watermark
        WHEN splitwise_sync_account.updated_watermark IS NULL OR excluded.updated_watermark > splitwise_sync_account.updated_watermark
        THEN excluded.updated_watermark ELSE splitwise_sync_account.updated_watermark END,
      full_synced_at=COALESCE(excluded.full_synced_at, splitwise_sync_account.full_synced_at)`)
      .run(accountId, new Date().toISOString(), watermark, commit?.mode === "full" ? commit.startedAt : null);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export type SavedSplitwiseExpense = SplitwiseExpense & { categoryId: number | null };
export function listSplitwiseImports(limit = 200): { expenses: SavedSplitwiseExpense[]; syncedAt: string | null } {
  migrate();
  const db = getDb();
  const account = db.prepare("SELECT account_id, synced_at FROM splitwise_sync_account WHERE singleton=1").get() as { account_id: number; synced_at: string } | undefined;
  if (!account) return { expenses: [], syncedAt: null };
  const rows = db.prepare(`SELECT expense_id AS id, txn_date AS date, description, currency, total, paid, owed, payment, deleted, category_id AS categoryId
    FROM splitwise_imports WHERE account_id=? ORDER BY txn_date DESC, expense_id DESC LIMIT ?`).all(account.account_id, limit) as Array<Omit<SavedSplitwiseExpense, "payment" | "deleted"> & { payment: number; deleted: number }>;
  return { expenses: rows.map((row) => ({ ...row, payment: Boolean(row.payment), deleted: Boolean(row.deleted) })), syncedAt: account.synced_at };
}

export function setSplitwiseCategory(id: number, categoryId: number): void {
  migrate();
  const db = getDb();
  const row = db.prepare(`SELECT i.description FROM splitwise_imports i JOIN splitwise_sync_account a ON a.account_id=i.account_id
    WHERE a.singleton=1 AND i.expense_id=? AND i.payment=0`).get(id) as { description: string } | undefined;
  if (!row) throw new Error("Invalid Splitwise expense.");
  db.exec("BEGIN IMMEDIATE");
  try { rememberImportCategory(row.description, categoryId); db.prepare("UPDATE splitwise_imports SET category_id=? WHERE expense_id=? AND account_id=(SELECT account_id FROM splitwise_sync_account WHERE singleton=1)").run(categoryId, id); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}


export type PairExclusion = { bankId: number; splitwiseId: number };
/** Exclusions are local decisions, retained across provider re-syncs. */
export function listPairExclusions(): PairExclusion[] {
  migrate();
  return getDb().prepare(`SELECT e.transaction_id AS bankId, e.expense_id AS splitwiseId FROM import_pair_exclusions e
    JOIN splitwise_sync_account a ON a.account_id=e.account_id WHERE a.singleton=1`).all() as PairExclusion[];
}
export function setPairExclusion(bankId: number, splitwiseId: number, excluded: boolean): void {
  if (![bankId, splitwiseId].every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error("Invalid pair.");
  migrate(); const db = getDb();
  const row = db.prepare(`SELECT t.id AS bankId, i.expense_id AS splitwiseId, i.account_id AS accountId
    FROM transactions t JOIN splitwise_imports i ON i.expense_id=? JOIN splitwise_sync_account a ON a.account_id=i.account_id
    WHERE t.id=? AND t.user_id=? AND a.singleton=1`).get(splitwiseId, bankId, LOCAL_USER_ID) as { accountId: number } | undefined;
  if (!row) throw new Error("Pair not found.");
  if (excluded) db.prepare("INSERT OR IGNORE INTO import_pair_exclusions (transaction_id,account_id,expense_id) VALUES (?,?,?)").run(bankId,row.accountId,splitwiseId);
  else db.prepare("DELETE FROM import_pair_exclusions WHERE transaction_id=? AND account_id=? AND expense_id=?").run(bankId,row.accountId,splitwiseId);
}
