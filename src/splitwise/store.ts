import { getDb } from "@/src/db/client";
import { automaticImportCategory, LOCAL_USER_ID, migrate, rememberImportCategory } from "@/src/db/repository";
import { ReconciliationError } from "@/src/actions/error-codes";
import { confirmablePair, type ActualBank, type ActualShared, type PairRef } from "@/src/finance/actual-spending";
import type { SplitwiseExpense } from "./client";

/** Store only a completed snapshot. Missing records are retained, never guessed deleted. */
export function saveSplitwiseSnapshot(accountId: number, expenses: SplitwiseExpense[]): void {
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
    db.prepare(`INSERT INTO splitwise_sync_account (singleton, account_id, synced_at) VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET synced_at=excluded.synced_at`).run(accountId, new Date().toISOString());
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


export type PairExclusion = PairRef;
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
/** Exclusions are local decisions, retained across provider re-syncs. */
export function listPairExclusions(): PairExclusion[] {
  migrate();
  return getDb().prepare(`SELECT e.transaction_id AS bankId, e.expense_id AS splitwiseId FROM import_pair_exclusions e
    JOIN splitwise_sync_account a ON a.account_id=e.account_id WHERE a.singleton=1`).all() as PairExclusion[];
}
/** A rejection and a manual confirmation of the same pair are mutually exclusive. */
export function setPairExclusion(bankId: number, splitwiseId: number, excluded: boolean): void {
  if (![bankId, splitwiseId].every(validId)) throw new ReconciliationError("not-found");
  migrate(); const db = getDb();
  const row = db.prepare(`SELECT t.id AS bankId, i.expense_id AS splitwiseId, i.account_id AS accountId
    FROM transactions t JOIN splitwise_imports i ON i.expense_id=? JOIN splitwise_sync_account a ON a.account_id=i.account_id
    WHERE t.id=? AND t.user_id=? AND a.singleton=1`).get(splitwiseId, bankId, LOCAL_USER_ID) as { accountId: number } | undefined;
  if (!row) throw new ReconciliationError("not-found");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (excluded) {
      db.prepare("DELETE FROM import_pair_confirmations WHERE transaction_id=? AND account_id=? AND expense_id=?").run(bankId, row.accountId, splitwiseId);
      db.prepare("INSERT OR IGNORE INTO import_pair_exclusions (transaction_id,account_id,expense_id) VALUES (?,?,?)").run(bankId, row.accountId, splitwiseId);
    } else db.prepare("DELETE FROM import_pair_exclusions WHERE transaction_id=? AND account_id=? AND expense_id=?").run(bankId, row.accountId, splitwiseId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Pairs the owner confirmed by hand for the current Splitwise account (MEJ-003). */
export function listPairConfirmations(): PairRef[] {
  migrate();
  return getDb().prepare(`SELECT c.transaction_id AS bankId, c.expense_id AS splitwiseId FROM import_pair_confirmations c
    JOIN splitwise_sync_account a ON a.account_id=c.account_id WHERE a.singleton=1`).all() as PairRef[];
}

/**
 * Stores a manual pair after re-reading both records from the database: amounts, currency, month and
 * dates come from stored rows, never from the form. Refuses a side that is already in another
 * confirmed pair, and clears a rejection of the same pair.
 */
export function confirmPair(bankId: number, splitwiseId: number, month: string): void {
  if (![bankId, splitwiseId].every(validId)) throw new ReconciliationError("not-found");
  migrate(); const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const bank = db.prepare(`SELECT t.id, t.txn_date AS txnDate, t.description, t.currency_code AS currencyCode, t.amount_minor AS amountMinor,
      t.kind, COALESCE(r.decision, t.status) AS status
      FROM transactions t LEFT JOIN transaction_reviews r ON r.transaction_id=t.id WHERE t.id=? AND t.user_id=?`).get(bankId, LOCAL_USER_ID) as ActualBank | undefined;
    const stored = db.prepare(`SELECT i.account_id AS accountId, i.expense_id AS id, i.txn_date AS date, i.description, i.currency, i.total, i.paid, i.owed,
      i.payment, i.deleted FROM splitwise_imports i JOIN splitwise_sync_account a ON a.account_id=i.account_id
      WHERE a.singleton=1 AND i.expense_id=?`).get(splitwiseId) as (Omit<ActualShared, "payment" | "deleted"> & { accountId: number; payment: number; deleted: number }) | undefined;
    if (!bank || !stored) throw new ReconciliationError("not-found");
    const units = db.prepare("SELECT code, minor_unit AS minorUnit FROM currencies").all() as Array<{ code: string; minorUnit: number }>;
    const shared: ActualShared = { ...stored, payment: Boolean(stored.payment), deleted: Boolean(stored.deleted) };
    if (confirmablePair(month, bank, shared, new Map(units.map((unit) => [unit.code, unit.minorUnit]))) === null) throw new ReconciliationError("pair-changed");
    const taken = db.prepare(`SELECT 1 AS taken FROM import_pair_confirmations
      WHERE (transaction_id=? OR (account_id=? AND expense_id=?)) AND NOT (transaction_id=? AND account_id=? AND expense_id=?)`)
      .get(bankId, stored.accountId, splitwiseId, bankId, stored.accountId, splitwiseId);
    if (taken) throw new ReconciliationError("already-paired");
    db.prepare("DELETE FROM import_pair_exclusions WHERE transaction_id=? AND account_id=? AND expense_id=?").run(bankId, stored.accountId, splitwiseId);
    db.prepare("INSERT OR IGNORE INTO import_pair_confirmations (transaction_id,account_id,expense_id) VALUES (?,?,?)").run(bankId, stored.accountId, splitwiseId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Removes a manual pair; the two records go back to the automatic rule and suggestions. */
export function removePairConfirmation(bankId: number, splitwiseId: number): void {
  if (![bankId, splitwiseId].every(validId)) throw new ReconciliationError("not-found");
  migrate();
  const result = getDb().prepare(`DELETE FROM import_pair_confirmations WHERE transaction_id=? AND expense_id=?
    AND account_id=(SELECT account_id FROM splitwise_sync_account WHERE singleton=1)`).run(bankId, splitwiseId);
  if (result.changes === 0) throw new ReconciliationError("not-found");
}
