import { getDb } from "./client";
import { merchantKey } from "../finance/merchant-key";
import { isSenderAuthVerdict, type SenderAuthVerdict } from "../ingest/sender-auth";

export const LOCAL_USER_ID = "mdaneri";
const LEGACY_LOCAL_USER_ID = "local-user";

export type CategoryType = "income" | "expense";
export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type CustomRecurrenceUnit = "weeks" | "months" | "years";
export type CustomRecurrenceAnchor = "day_of_month" | "day_of_week";

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  isBase: boolean;
};

export type Category = {
  id: number;
  userId: string;
  name: string;
  type: CategoryType;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type ExpenseGroup = {
  id: number;
  userId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
};

export type IncomeItem = {
  id: number;
  userId: string;
  categoryId: number;
  categoryName: string;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  frequency: Frequency;
  customInterval: number | null;
  customUnit: CustomRecurrenceUnit | null;
  customAnchor: CustomRecurrenceAnchor | null;
  customDayOfMonth: number | null;
  customDayOfWeek: number | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
};

export type RecurringExpense = {
  id: number;
  userId: string;
  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  frequency: Frequency;
  customInterval: number | null;
  customUnit: CustomRecurrenceUnit | null;
  customAnchor: CustomRecurrenceAnchor | null;
  customDayOfMonth: number | null;
  customDayOfWeek: number | null;
  isOptional: boolean;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
};

export type FinancialPlan = {
  id: number;
  userId: string;
  name: string;
  targetDate: string;
  currencyCode: string;
  targetAmountMinor: number;
  fxRateToBase: number | null;
  notes: string | null;
  isActive: boolean;
};

export type PlanItem = {
  id: number;
  userId: string;
  planId: number;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  isDone: boolean;
  isActive: boolean;
};

export type TransactionKind = "purchase" | "transfer_out" | "transfer_in";
export type TransactionStatus = "confirmed" | "pending" | "discarded";

export type Transaction = {
  id: number;
  userId: string;
  txnDate: string;
  description: string;
  currencyCode: string;
  amountMinor: number;
  categoryId: number | null;
  kind: TransactionKind;
  cardNetwork: string | null;
  cardLast4: string | null;
  source: string;
  messageId: string | null;
  rawExcerpt: string | null;
  status: TransactionStatus;
  createdAt: string;
  /** Sender authentication recorded at import (MEJ-002); null for rows imported before it existed. */
  senderAuth: SenderAuthVerdict | null;
};

export function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      username TEXT,
      password_hash TEXT,
      password_salt TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      minor_unit INTEGER NOT NULL,
      is_base INTEGER NOT NULL DEFAULT 0 CHECK (is_base IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      fx_rate_to_base REAL,
      frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom')),
      custom_interval INTEGER CHECK (custom_interval IS NULL OR custom_interval > 0),
      custom_unit TEXT CHECK (custom_unit IS NULL OR custom_unit IN ('weeks', 'months', 'years')),
      custom_anchor TEXT CHECK (custom_anchor IS NULL OR custom_anchor IN ('day_of_month', 'day_of_week')),
      custom_day_of_month INTEGER CHECK (custom_day_of_month IS NULL OR custom_day_of_month BETWEEN 1 AND 31),
      custom_day_of_week INTEGER CHECK (custom_day_of_week IS NULL OR custom_day_of_week BETWEEN 0 AND 6),
      start_date TEXT NOT NULL DEFAULT '1970-01-01',
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      group_id INTEGER REFERENCES expense_groups(id),
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      fx_rate_to_base REAL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom')),
      custom_interval INTEGER CHECK (custom_interval IS NULL OR custom_interval > 0),
      custom_unit TEXT CHECK (custom_unit IS NULL OR custom_unit IN ('weeks', 'months', 'years')),
      custom_anchor TEXT CHECK (custom_anchor IS NULL OR custom_anchor IN ('day_of_month', 'day_of_week')),
      custom_day_of_month INTEGER CHECK (custom_day_of_month IS NULL OR custom_day_of_month BETWEEN 1 AND 31),
      custom_day_of_week INTEGER CHECK (custom_day_of_week IS NULL OR custom_day_of_week BETWEEN 0 AND 6),
      is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      total_income_base_minor INTEGER NOT NULL,
      total_expense_base_minor INTEGER NOT NULL,
      net_base_minor INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, month)
    );

    CREATE TABLE IF NOT EXISTS financial_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_date TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      target_amount_minor INTEGER NOT NULL CHECK (target_amount_minor >= 0),
      fx_rate_to_base REAL,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES financial_plans(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      fx_rate_to_base REAL,
      is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      txn_date TEXT NOT NULL,
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      category_id INTEGER REFERENCES categories(id),
      card_network TEXT,
      card_last4 TEXT,
      source TEXT NOT NULL DEFAULT 'itau_email',
      message_id TEXT,
      raw_excerpt TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending')),
      created_at TEXT NOT NULL
    );

    -- Idempotency: the email Message-ID is unique per notification, so re-processing
    -- the same mail (poll overlap, retry) cannot insert a duplicate. A content hash is
    -- deliberately NOT used as the unique key: two identical purchases (same merchant,
    -- amount and day) are distinct transactions and must both be kept.
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_message_idx
      ON transactions(user_id, message_id);

    CREATE TABLE IF NOT EXISTS transaction_reviews (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'discarded')),
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_cursors (
      mailbox_key TEXT PRIMARY KEY,
      uid_validity TEXT NOT NULL,
      last_uid INTEGER NOT NULL CHECK (last_uid >= 0)
    );

    CREATE TABLE IF NOT EXISTS ingest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      messages_seen INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS import_pair_exclusions (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      expense_id INTEGER NOT NULL,
      PRIMARY KEY (transaction_id, account_id, expense_id)
    );

    -- Pairs the owner confirmed by hand (MEJ-003). One confirmation per bank purchase and
    -- per Splitwise expense; the unique indexes enforce it even if a check is bypassed.
    CREATE TABLE IF NOT EXISTS import_pair_confirmations (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      expense_id INTEGER NOT NULL,
      PRIMARY KEY (transaction_id, account_id, expense_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS import_pair_confirmations_transaction_idx
      ON import_pair_confirmations(transaction_id);
    CREATE UNIQUE INDEX IF NOT EXISTS import_pair_confirmations_expense_idx
      ON import_pair_confirmations(account_id, expense_id);

    CREATE TABLE IF NOT EXISTS splitwise_sync_account (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      account_id INTEGER NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS splitwise_imports (
      account_id INTEGER NOT NULL,
      expense_id INTEGER NOT NULL,
      txn_date TEXT NOT NULL,
      description TEXT NOT NULL,
      currency TEXT NOT NULL,
      total TEXT NOT NULL,
      paid TEXT,
      owed TEXT,
      payment INTEGER NOT NULL CHECK (payment IN (0, 1)),
      deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
      category_id INTEGER REFERENCES categories(id),
      PRIMARY KEY (account_id, expense_id)
    );
    CREATE TABLE IF NOT EXISTS import_category_rules (
      description_key TEXT PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS splitwise_balance_observations (
      account_id INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      friend_id INTEGER NOT NULL,
      person TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount TEXT NOT NULL,
      PRIMARY KEY (account_id, observed_at, friend_id, currency)
    );
    CREATE TABLE IF NOT EXISTS splitwise_activity_events (
      account_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      event_type INTEGER NOT NULL,
      expense_id INTEGER NOT NULL,
      actor_id INTEGER,
      PRIMARY KEY (account_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS splitwise_activity_sync (
      account_id INTEGER PRIMARY KEY,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL
    );
  `);

  ensureColumn("transactions", "kind", "TEXT NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase', 'transfer_out', 'transfer_in'))");
  // Observation only (MEJ-002): nullable so older rows stay NULL ("not recorded").
  ensureColumn("transactions", "sender_auth", "TEXT CHECK (sender_auth IS NULL OR sender_auth IN ('pass', 'fail', 'none'))");
  ensureColumn("splitwise_imports", "category_id", "INTEGER REFERENCES categories(id)");
  // Incremental Splitwise sync: latest provider updated_at committed, and the last full pass.
  ensureColumn("splitwise_sync_account", "updated_watermark", "TEXT");
  ensureColumn("splitwise_sync_account", "full_synced_at", "TEXT");
  ensureUserAuthColumns();
  migrateLegacyLocalUser();
  ensureColumn("recurring_expenses", "is_optional", "INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1))");
  ensureCategorySortOrder();
  ensureIncomeItemsRecurrenceColumns();
  ensureRecurringExpensesCustomSchema();

  seedDefaults();
  ensureRecurringExpensesGroupColumn();
  const uncategorized = db.prepare("SELECT id, description FROM transactions WHERE user_id=? AND kind='purchase' AND category_id IS NULL").all(LOCAL_USER_ID) as Array<{ id: number; description: string }>;
  const updateCategory = db.prepare("UPDATE transactions SET category_id=? WHERE id=? AND user_id=? AND category_id IS NULL");
  for (const row of uncategorized) updateCategory.run(automaticImportCategory(row.description), row.id, LOCAL_USER_ID);
}

function ensureUserAuthColumns() {
  ensureColumn("users", "username", "TEXT");
  ensureColumn("users", "password_hash", "TEXT");
  ensureColumn("users", "password_salt", "TEXT");
}

function migrateLegacyLocalUser() {
  const db = getDb();
  const now = nowIso();
  const legacy = db.prepare("SELECT id FROM users WHERE id = ?").get(LEGACY_LOCAL_USER_ID) as { id: string } | undefined;

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, display_name, username, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(LOCAL_USER_ID, "mdaneri@budgetspin.local", "mdaneri", "mdaneri", now);

  db.prepare("UPDATE users SET username = COALESCE(username, ?) WHERE id = ?").run("mdaneri", LOCAL_USER_ID);

  if (!legacy) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF;");
  const childTables = [
    "categories",
    "expense_groups",
    "income_items",
    "recurring_expenses",
    "monthly_snapshots",
    "financial_plans",
    "plan_items"
  ];

  for (const tableName of childTables) {
    db.prepare(`UPDATE ${tableName} SET user_id = ? WHERE user_id = ?`).run(LOCAL_USER_ID, LEGACY_LOCAL_USER_ID);
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(LEGACY_LOCAL_USER_ID);
  db.exec("PRAGMA foreign_keys = ON;");
}

function ensureCategorySortOrder() {
  ensureColumn("categories", "sort_order", "INTEGER NOT NULL DEFAULT 0");

  const db = getDb();
  const stats = db.prepare(`
    SELECT COUNT(*) AS total, COUNT(CASE WHEN sort_order != 0 THEN 1 END) AS assigned
    FROM categories
    WHERE user_id = ?
  `).get(LOCAL_USER_ID) as { total: number; assigned: number };

  if (stats.total === 0 || stats.assigned > 0) {
    return;
  }

  const rows = db.prepare(`
    SELECT id
    FROM categories
    WHERE user_id = ?
    ORDER BY type, created_at, id
  `).all(LOCAL_USER_ID) as Array<{ id: number }>;

  const updateStmt = db.prepare("UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?");
  rows.forEach((row, index) => {
    updateStmt.run(index, row.id, LOCAL_USER_ID);
  });
}

function ensureIncomeItemsRecurrenceColumns() {
  ensureColumn(
    "income_items",
    "frequency",
    "TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'))"
  );
  ensureColumn("income_items", "custom_interval", "INTEGER CHECK (custom_interval IS NULL OR custom_interval > 0)");
  ensureColumn("income_items", "custom_unit", "TEXT CHECK (custom_unit IS NULL OR custom_unit IN ('weeks', 'months', 'years'))");
  ensureColumn(
    "income_items",
    "custom_anchor",
    "TEXT CHECK (custom_anchor IS NULL OR custom_anchor IN ('day_of_month', 'day_of_week'))"
  );
  ensureColumn(
    "income_items",
    "custom_day_of_month",
    "INTEGER CHECK (custom_day_of_month IS NULL OR custom_day_of_month BETWEEN 1 AND 31)"
  );
  ensureColumn(
    "income_items",
    "custom_day_of_week",
    "INTEGER CHECK (custom_day_of_week IS NULL OR custom_day_of_week BETWEEN 0 AND 6)"
  );
  ensureColumn("income_items", "start_date", "TEXT NOT NULL DEFAULT '1970-01-01'");
  ensureColumn("income_items", "end_date", "TEXT");
}

function ensureRecurringExpensesCustomSchema() {
  const db = getDb();
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recurring_expenses'")
    .get() as { sql: string } | undefined;

  if (
    row?.sql.includes("'custom'") &&
    row.sql.includes("custom_interval") &&
    row.sql.includes("custom_day_of_week")
  ) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;

    CREATE TABLE recurring_expenses_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      group_id INTEGER REFERENCES expense_groups(id),
      description TEXT NOT NULL,
      currency_code TEXT NOT NULL REFERENCES currencies(code),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      fx_rate_to_base REAL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom')),
      custom_interval INTEGER CHECK (custom_interval IS NULL OR custom_interval > 0),
      custom_unit TEXT CHECK (custom_unit IS NULL OR custom_unit IN ('weeks', 'months', 'years')),
      custom_anchor TEXT CHECK (custom_anchor IS NULL OR custom_anchor IN ('day_of_month', 'day_of_week')),
      custom_day_of_month INTEGER CHECK (custom_day_of_month IS NULL OR custom_day_of_month BETWEEN 1 AND 31),
      custom_day_of_week INTEGER CHECK (custom_day_of_week IS NULL OR custom_day_of_week BETWEEN 0 AND 6),
      is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO recurring_expenses_new (
      id, user_id, category_id, group_id, description, currency_code, amount_minor,
      fx_rate_to_base, frequency, custom_interval, custom_unit, custom_anchor,
      custom_day_of_month, custom_day_of_week, is_optional, start_date, end_date,
      is_active, created_at, updated_at
    )
    SELECT
      id, user_id, category_id, NULL, description, currency_code, amount_minor,
      fx_rate_to_base, frequency, NULL, NULL, NULL, NULL, NULL,
      COALESCE(is_optional, 0), start_date, end_date, is_active, created_at, updated_at
    FROM recurring_expenses;

    DROP TABLE recurring_expenses;
    ALTER TABLE recurring_expenses_new RENAME TO recurring_expenses;

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureRecurringExpensesGroupColumn() {
  ensureColumn("recurring_expenses", "group_id", "INTEGER REFERENCES expense_groups(id)");

  const db = getDb();
  const defaultGroupId = getDefaultExpenseGroupId();

  db.prepare(`
    UPDATE recurring_expenses
    SET group_id = ?
    WHERE user_id = ? AND group_id IS NULL
  `).run(defaultGroupId, LOCAL_USER_ID);
}

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const db = getDb();
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function seedDefaults() {
  const db = getDb();
  const now = nowIso();

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(LOCAL_USER_ID, "mdaneri@budgetspin.local", "mdaneri", now);

  db.prepare("UPDATE users SET username = COALESCE(username, ?) WHERE id = ?").run("mdaneri", LOCAL_USER_ID);

  const currencies = [
    ["UYU", "Uruguayan Peso", "$U", 2, 1],
    ["USD", "US Dollar", "US$", 2, 0],
    ["EUR", "Euro", "€", 2, 0],
    ["ARS", "Argentine Peso", "AR$", 2, 0]
  ] as const;

  const currencyStmt = db.prepare(`
    INSERT OR IGNORE INTO currencies (code, name, symbol, minor_unit, is_base)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const currency of currencies) {
    currencyStmt.run(...currency);
  }

  const categoryCount = db
    .prepare("SELECT COUNT(*) AS count FROM categories WHERE user_id = ?")
    .get(LOCAL_USER_ID) as { count: number };

  if (categoryCount.count === 0) {
    const stmt = db.prepare(`
      INSERT INTO categories (user_id, name, type, is_active, sort_order, created_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);

    let sortOrder = 0;

    for (const name of ["Salary", "Freelance", "Investments"]) {
      stmt.run(LOCAL_USER_ID, name, "income", sortOrder, now);
      sortOrder += 1;
    }

    for (const name of ["Housing", "Utilities", "Subscriptions", "Transport", "Food", "Health"]) {
      stmt.run(LOCAL_USER_ID, name, "expense", sortOrder, now);
      sortOrder += 1;
    }
  }

  const groupCount = db
    .prepare("SELECT COUNT(*) AS count FROM expense_groups WHERE user_id = ?")
    .get(LOCAL_USER_ID) as { count: number };

  if (groupCount.count === 0) {
    db.prepare(`
      INSERT INTO expense_groups (user_id, name, is_active, created_at)
      VALUES (?, ?, 1, ?)
    `).run(LOCAL_USER_ID, "General", now);
  }
}

export function getLocalUserId() {
  migrate();
  return LOCAL_USER_ID;
}

export function listCurrencies(): Currency[] {
  migrate();
  const rows = getDb()
    .prepare("SELECT code, name, symbol, minor_unit, is_base FROM currencies ORDER BY is_base DESC, code")
    .all() as Array<{
    code: string;
    name: string;
    symbol: string;
    minor_unit: number;
    is_base: number;
  }>;

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    minorUnit: row.minor_unit,
    isBase: row.is_base === 1
  }));
}

export function getBaseCurrency() {
  const base = listCurrencies().find((currency) => currency.isBase);
  if (!base) {
    throw new Error("No base currency configured.");
  }

  return base;
}

export function saveCurrency(input: Currency) {
  migrate();
  getDb()
    .prepare(`
      INSERT INTO currencies (code, name, symbol, minor_unit, is_base)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        symbol = excluded.symbol,
        minor_unit = excluded.minor_unit
    `)
    .run(input.code.toUpperCase(), input.name, input.symbol, input.minorUnit, input.isBase ? 1 : 0);
}

export function setBaseCurrency(code: string) {
  migrate();
  const db = getDb();
  db.exec("UPDATE currencies SET is_base = 0");
  db.prepare("UPDATE currencies SET is_base = 1 WHERE code = ?").run(code);
}

export function listCategories(type?: CategoryType, activeOnly = true): Category[] {
  migrate();
  const clauses = ["user_id = ?"];
  const params: Array<string | number> = [LOCAL_USER_ID];

  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }

  if (activeOnly) {
    clauses.push("is_active = 1");
  }

  const rows = getDb()
    .prepare(`
      SELECT id, user_id, name, type, is_active, created_at
      , sort_order
      FROM categories
      WHERE ${clauses.join(" AND ")}
      ORDER BY type, sort_order, name
    `)
    .all(...params) as Array<{
    id: number;
    user_id: string;
    name: string;
    type: CategoryType;
    is_active: number;
    sort_order: number;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }));
}

export function upsertCategory(input: {
  id?: number;
  name: string;
  type: CategoryType;
  isActive?: boolean;
}) {
  migrate();
  const db = getDb();

  if (input.id) {
    db.prepare(`
      UPDATE categories
      SET name = ?, type = ?, is_active = ?
      WHERE id = ? AND user_id = ?
    `).run(input.name, input.type, input.isActive === false ? 0 : 1, input.id, LOCAL_USER_ID);
    return;
  }

  db.prepare(`
    INSERT INTO categories (user_id, name, type, is_active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(LOCAL_USER_ID, input.name, input.type, nowIso());
}

export function deactivateCategory(id: number) {
  migrate();
  getDb()
    .prepare("UPDATE categories SET is_active = 0 WHERE id = ? AND user_id = ?")
    .run(id, LOCAL_USER_ID);
}

export function reorderExpenseCategories(categoryIds: number[]) {
  migrate();
  const db = getDb();
  const expenseCategories = listCategories("expense", false);
  const allowedIds = new Set(expenseCategories.map((category) => category.id));

  if (categoryIds.length === 0 || categoryIds.some((id) => !allowedIds.has(id))) {
    throw new Error("Invalid expense category order.");
  }

  const requestedIds = new Set(categoryIds);
  const orderedIds = [
    ...categoryIds,
    ...expenseCategories.filter((category) => !requestedIds.has(category.id)).map((category) => category.id)
  ];
  const updateStmt = db.prepare("UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?");
  orderedIds.forEach((id, index) => {
    updateStmt.run(index, id, LOCAL_USER_ID);
  });
}

export function listExpenseGroups(activeOnly = true): ExpenseGroup[] {
  migrate();
  const clauses = ["user_id = ?"];
  const params: Array<string | number> = [LOCAL_USER_ID];

  if (activeOnly) {
    clauses.push("is_active = 1");
  }

  const rows = getDb()
    .prepare(`
      SELECT id, user_id, name, is_active, created_at
      FROM expense_groups
      WHERE ${clauses.join(" AND ")}
      ORDER BY is_active DESC, name
    `)
    .all(...params) as Array<{
    id: number;
    user_id: string;
    name: string;
    is_active: number;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at
  }));
}

export function upsertExpenseGroup(input: { id?: number; name: string; isActive?: boolean }) {
  migrate();
  const db = getDb();

  if (input.id) {
    db.prepare(`
      UPDATE expense_groups
      SET name = ?, is_active = ?
      WHERE id = ? AND user_id = ?
    `).run(input.name, input.isActive === false ? 0 : 1, input.id, LOCAL_USER_ID);
    return;
  }

  db.prepare(`
    INSERT INTO expense_groups (user_id, name, is_active, created_at)
    VALUES (?, ?, 1, ?)
  `).run(LOCAL_USER_ID, input.name, nowIso());
}

/** Thrown when trying to deactivate the default ("General") expense family. */
export class DefaultExpenseGroupError extends Error {
  constructor() {
    super("The General expense family cannot be deactivated.");
    this.name = "DefaultExpenseGroupError";
  }
}

export function deactivateExpenseGroup(id: number) {
  migrate();
  const defaultGroupId = getDefaultExpenseGroupId();

  if (id === defaultGroupId) {
    throw new DefaultExpenseGroupError();
  }

  const db = getDb();
  db.prepare("UPDATE recurring_expenses SET group_id = ? WHERE group_id = ? AND user_id = ?").run(
    defaultGroupId,
    id,
    LOCAL_USER_ID
  );
  db.prepare("UPDATE expense_groups SET is_active = 0 WHERE id = ? AND user_id = ?").run(id, LOCAL_USER_ID);
}

function getDefaultExpenseGroupId() {
  const db = getDb();
  let row = db
    .prepare("SELECT id FROM expense_groups WHERE user_id = ? AND name = ? ORDER BY id LIMIT 1")
    .get(LOCAL_USER_ID, "General") as { id: number } | undefined;

  if (!row) {
    db.prepare(`
      INSERT INTO expense_groups (user_id, name, is_active, created_at)
      VALUES (?, ?, 1, ?)
    `).run(LOCAL_USER_ID, "General", nowIso());
    row = db
      .prepare("SELECT id FROM expense_groups WHERE user_id = ? AND name = ? ORDER BY id LIMIT 1")
      .get(LOCAL_USER_ID, "General") as { id: number };
  }

  return row.id;
}

export function listIncomeItems(): IncomeItem[] {
  migrate();
  const rows = getDb()
    .prepare(`
      SELECT i.id, i.user_id, i.category_id, c.name AS category_name, i.description,
        i.currency_code, i.amount_minor, i.fx_rate_to_base, i.frequency,
        i.custom_interval, i.custom_unit, i.custom_anchor, i.custom_day_of_month,
        i.custom_day_of_week, i.start_date, i.end_date, i.is_active
      FROM income_items i
      JOIN categories c ON c.id = i.category_id
      WHERE i.user_id = ? AND i.is_active = 1
      ORDER BY i.description
    `)
    .all(LOCAL_USER_ID) as Array<{
    id: number;
    user_id: string;
    category_id: number;
    category_name: string;
    description: string;
    currency_code: string;
    amount_minor: number;
    fx_rate_to_base: number | null;
    frequency: Frequency;
    custom_interval: number | null;
    custom_unit: CustomRecurrenceUnit | null;
    custom_anchor: CustomRecurrenceAnchor | null;
    custom_day_of_month: number | null;
    custom_day_of_week: number | null;
    start_date: string;
    end_date: string | null;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    description: row.description,
    currencyCode: row.currency_code,
    amountMinor: row.amount_minor,
    fxRateToBase: row.fx_rate_to_base,
    frequency: row.frequency,
    customInterval: row.custom_interval,
    customUnit: row.custom_unit,
    customAnchor: row.custom_anchor,
    customDayOfMonth: row.custom_day_of_month,
    customDayOfWeek: row.custom_day_of_week,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active === 1
  }));
}

export function upsertIncomeItem(input: {
  id?: number;
  categoryId: number;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  frequency?: Frequency;
  customInterval?: number | null;
  customUnit?: CustomRecurrenceUnit | null;
  customAnchor?: CustomRecurrenceAnchor | null;
  customDayOfMonth?: number | null;
  customDayOfWeek?: number | null;
  startDate?: string;
  endDate?: string | null;
}) {
  migrate();
  const db = getDb();
  const now = nowIso();
  const frequency = input.frequency ?? "monthly";
  const startDate = input.startDate ?? "1970-01-01";

  if (input.id) {
    db.prepare(`
      UPDATE income_items
      SET category_id = ?, description = ?, currency_code = ?, amount_minor = ?,
        fx_rate_to_base = ?, frequency = ?, custom_interval = ?, custom_unit = ?,
        custom_anchor = ?, custom_day_of_month = ?, custom_day_of_week = ?,
        start_date = ?, end_date = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.categoryId,
      input.description,
      input.currencyCode,
      input.amountMinor,
      input.fxRateToBase,
      frequency,
      input.customInterval ?? null,
      input.customUnit ?? null,
      input.customAnchor ?? null,
      input.customDayOfMonth ?? null,
      input.customDayOfWeek ?? null,
      startDate,
      input.endDate ?? null,
      now,
      input.id,
      LOCAL_USER_ID
    );
    return;
  }

  db.prepare(`
    INSERT INTO income_items (
      user_id, category_id, description, currency_code, amount_minor,
      fx_rate_to_base, frequency, custom_interval, custom_unit, custom_anchor,
      custom_day_of_month, custom_day_of_week, start_date, end_date,
      is_active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    LOCAL_USER_ID,
    input.categoryId,
    input.description,
    input.currencyCode,
    input.amountMinor,
    input.fxRateToBase,
    frequency,
    input.customInterval ?? null,
    input.customUnit ?? null,
    input.customAnchor ?? null,
    input.customDayOfMonth ?? null,
    input.customDayOfWeek ?? null,
    startDate,
    input.endDate ?? null,
    now,
    now
  );
}

export function deleteIncomeItem(id: number) {
  migrate();
  getDb()
    .prepare("UPDATE income_items SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(nowIso(), id, LOCAL_USER_ID);
}

export function listRecurringExpenses(): RecurringExpense[] {
  migrate();
  const rows = getDb()
    .prepare(`
      SELECT e.id, e.user_id, e.category_id, c.name AS category_name,
        COALESCE(g.id, ?) AS group_id, COALESCE(g.name, 'General') AS group_name,
        e.description,
        e.currency_code, e.amount_minor, e.fx_rate_to_base, e.frequency,
        e.custom_interval, e.custom_unit, e.custom_anchor, e.custom_day_of_month,
        e.custom_day_of_week, e.is_optional,
        e.start_date, e.end_date, e.is_active
      FROM recurring_expenses e
      JOIN categories c ON c.id = e.category_id
      LEFT JOIN expense_groups g ON g.id = e.group_id
      WHERE e.user_id = ? AND e.is_active = 1
      ORDER BY e.description
    `)
    .all(getDefaultExpenseGroupId(), LOCAL_USER_ID) as Array<{
    id: number;
    user_id: string;
    category_id: number;
    category_name: string;
    group_id: number;
    group_name: string;
    description: string;
    currency_code: string;
    amount_minor: number;
    fx_rate_to_base: number | null;
    frequency: Frequency;
    custom_interval: number | null;
    custom_unit: CustomRecurrenceUnit | null;
    custom_anchor: CustomRecurrenceAnchor | null;
    custom_day_of_month: number | null;
    custom_day_of_week: number | null;
    is_optional: number;
    start_date: string;
    end_date: string | null;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    groupId: row.group_id,
    groupName: row.group_name,
    description: row.description,
    currencyCode: row.currency_code,
    amountMinor: row.amount_minor,
    fxRateToBase: row.fx_rate_to_base,
    frequency: row.frequency,
    customInterval: row.custom_interval,
    customUnit: row.custom_unit,
    customAnchor: row.custom_anchor,
    customDayOfMonth: row.custom_day_of_month,
    customDayOfWeek: row.custom_day_of_week,
    isOptional: row.is_optional === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active === 1
  }));
}

export function upsertRecurringExpense(input: {
  id?: number;
  categoryId: number;
  groupId?: number | null;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  frequency: Frequency;
  customInterval?: number | null;
  customUnit?: CustomRecurrenceUnit | null;
  customAnchor?: CustomRecurrenceAnchor | null;
  customDayOfMonth?: number | null;
  customDayOfWeek?: number | null;
  isOptional: boolean;
  startDate: string;
  endDate: string | null;
}) {
  migrate();
  const db = getDb();
  const now = nowIso();

  if (input.id) {
    db.prepare(`
      UPDATE recurring_expenses
      SET category_id = ?, group_id = ?, description = ?, currency_code = ?, amount_minor = ?,
        fx_rate_to_base = ?, frequency = ?, custom_interval = ?, custom_unit = ?,
        custom_anchor = ?, custom_day_of_month = ?, custom_day_of_week = ?,
        is_optional = ?, start_date = ?, end_date = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.categoryId,
      input.groupId ?? getDefaultExpenseGroupId(),
      input.description,
      input.currencyCode,
      input.amountMinor,
      input.fxRateToBase,
      input.frequency,
      input.customInterval ?? null,
      input.customUnit ?? null,
      input.customAnchor ?? null,
      input.customDayOfMonth ?? null,
      input.customDayOfWeek ?? null,
      input.isOptional ? 1 : 0,
      input.startDate,
      input.endDate,
      now,
      input.id,
      LOCAL_USER_ID
    );
    return;
  }

  db.prepare(`
    INSERT INTO recurring_expenses (
      user_id, category_id, group_id, description, currency_code, amount_minor,
      fx_rate_to_base, frequency, custom_interval, custom_unit, custom_anchor,
      custom_day_of_month, custom_day_of_week, is_optional, start_date, end_date,
      is_active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    LOCAL_USER_ID,
    input.categoryId,
    input.groupId ?? getDefaultExpenseGroupId(),
    input.description,
    input.currencyCode,
    input.amountMinor,
    input.fxRateToBase,
    input.frequency,
    input.customInterval ?? null,
    input.customUnit ?? null,
    input.customAnchor ?? null,
    input.customDayOfMonth ?? null,
    input.customDayOfWeek ?? null,
    input.isOptional ? 1 : 0,
    input.startDate,
    input.endDate,
    now,
    now
  );
}

export function deleteRecurringExpense(id: number) {
  migrate();
  getDb()
    .prepare("UPDATE recurring_expenses SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(nowIso(), id, LOCAL_USER_ID);
}

export function listFinancialPlans(): FinancialPlan[] {
  migrate();
  const rows = getDb()
    .prepare(`
      SELECT id, user_id, name, target_date, currency_code, target_amount_minor,
        fx_rate_to_base, notes, is_active
      FROM financial_plans
      WHERE user_id = ? AND is_active = 1
      ORDER BY target_date, name
    `)
    .all(LOCAL_USER_ID) as Array<{
    id: number;
    user_id: string;
    name: string;
    target_date: string;
    currency_code: string;
    target_amount_minor: number;
    fx_rate_to_base: number | null;
    notes: string | null;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    targetDate: row.target_date,
    currencyCode: row.currency_code,
    targetAmountMinor: row.target_amount_minor,
    fxRateToBase: row.fx_rate_to_base,
    notes: row.notes,
    isActive: row.is_active === 1
  }));
}

export function upsertFinancialPlan(input: {
  id?: number;
  name: string;
  targetDate: string;
  currencyCode: string;
  targetAmountMinor: number;
  fxRateToBase: number | null;
  notes: string | null;
}) {
  migrate();
  const db = getDb();
  const now = nowIso();

  if (input.id) {
    db.prepare(`
      UPDATE financial_plans
      SET name = ?, target_date = ?, currency_code = ?, target_amount_minor = ?,
        fx_rate_to_base = ?, notes = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.name,
      input.targetDate,
      input.currencyCode,
      input.targetAmountMinor,
      input.fxRateToBase,
      input.notes,
      now,
      input.id,
      LOCAL_USER_ID
    );
    return;
  }

  db.prepare(`
    INSERT INTO financial_plans (
      user_id, name, target_date, currency_code, target_amount_minor,
      fx_rate_to_base, notes, is_active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    LOCAL_USER_ID,
    input.name,
    input.targetDate,
    input.currencyCode,
    input.targetAmountMinor,
    input.fxRateToBase,
    input.notes,
    now,
    now
  );
}

export function deleteFinancialPlan(id: number) {
  migrate();
  const db = getDb();
  const now = nowIso();
  db.prepare("UPDATE financial_plans SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?").run(
    now,
    id,
    LOCAL_USER_ID
  );
  db.prepare("UPDATE plan_items SET is_active = 0, updated_at = ? WHERE plan_id = ? AND user_id = ?").run(
    now,
    id,
    LOCAL_USER_ID
  );
}

export function listPlanItems(planId?: number): PlanItem[] {
  migrate();
  const clauses = ["user_id = ?", "is_active = 1"];
  const params: Array<string | number> = [LOCAL_USER_ID];

  if (planId) {
    clauses.push("plan_id = ?");
    params.push(planId);
  }

  const rows = getDb()
    .prepare(`
      SELECT id, user_id, plan_id, description, currency_code, amount_minor,
        fx_rate_to_base, is_done, is_active
      FROM plan_items
      WHERE ${clauses.join(" AND ")}
      ORDER BY is_done, description
    `)
    .all(...params) as Array<{
    id: number;
    user_id: string;
    plan_id: number;
    description: string;
    currency_code: string;
    amount_minor: number;
    fx_rate_to_base: number | null;
    is_done: number;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    description: row.description,
    currencyCode: row.currency_code,
    amountMinor: row.amount_minor,
    fxRateToBase: row.fx_rate_to_base,
    isDone: row.is_done === 1,
    isActive: row.is_active === 1
  }));
}

export function upsertPlanItem(input: {
  id?: number;
  planId: number;
  description: string;
  currencyCode: string;
  amountMinor: number;
  fxRateToBase: number | null;
  isDone: boolean;
}) {
  migrate();
  const db = getDb();
  const now = nowIso();

  if (input.id) {
    db.prepare(`
      UPDATE plan_items
      SET description = ?, currency_code = ?, amount_minor = ?, fx_rate_to_base = ?,
        is_done = ?, updated_at = ?
      WHERE id = ? AND plan_id = ? AND user_id = ?
    `).run(
      input.description,
      input.currencyCode,
      input.amountMinor,
      input.fxRateToBase,
      input.isDone ? 1 : 0,
      now,
      input.id,
      input.planId,
      LOCAL_USER_ID
    );
    return;
  }

  db.prepare(`
    INSERT INTO plan_items (
      user_id, plan_id, description, currency_code, amount_minor,
      fx_rate_to_base, is_done, is_active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    LOCAL_USER_ID,
    input.planId,
    input.description,
    input.currencyCode,
    input.amountMinor,
    input.fxRateToBase,
    input.isDone ? 1 : 0,
    now,
    now
  );
}

export function setPlanItemDone(id: number, isDone: boolean) {
  migrate();
  getDb()
    .prepare("UPDATE plan_items SET is_done = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(isDone ? 1 : 0, nowIso(), id, LOCAL_USER_ID);
}

export function deletePlanItem(id: number) {
  migrate();
  getDb()
    .prepare("UPDATE plan_items SET is_active = 0, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(nowIso(), id, LOCAL_USER_ID);
}

/**
 * Inserts an imported transaction, skipping it if its Message-ID was already
 * recorded for this user (idempotent re-processing). Returns whether a row was
 * actually inserted so the ingest run can report inserted vs skipped.
 */
/**
 * Keys stored in import_category_rules.description_key:
 *  - exact rule:    the trimmed, whitespace-collapsed, lower-cased description;
 *  - merchant rule: MERCHANT_RULE_PREFIX + merchantKey(description).
 * The prefix starts with a tab. An exact key is trim()med, and trim() removes
 * exactly the characters \s matches, so an exact key can never start with a
 * tab: the two kinds cannot collide and no schema change is needed.
 */
const MERCHANT_RULE_PREFIX = "\tmerchant:";

function exactRuleKey(description: string): string {
  return description.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function merchantRuleKey(description: string): string | null {
  const key = merchantKey(description);
  return key === null ? null : MERCHANT_RULE_PREFIX + key;
}

function ruleCategory(key: string): number | undefined {
  const rule = getDb().prepare(`SELECT c.id FROM import_category_rules r JOIN categories c ON c.id=r.category_id
    WHERE r.description_key=? AND c.user_id=? AND c.type='expense' AND c.is_active=1`).get(key, LOCAL_USER_ID) as { id: number } | undefined;
  return rule?.id;
}

/**
 * Call after migrate. Lookup order: exact-description rule, then merchant-key
 * rule, then the "Other" expense category. Rules are learned only from explicit
 * edits; this only chooses a category for a row being created or still NULL.
 */
export function automaticImportCategory(description: string): number {
  const db = getDb();
  const exact = ruleCategory(exactRuleKey(description));
  if (exact !== undefined) return exact;
  const merchantRule = merchantRuleKey(description);
  const byMerchant = merchantRule === null ? undefined : ruleCategory(merchantRule);
  if (byMerchant !== undefined) return byMerchant;
  let other = db.prepare("SELECT id FROM categories WHERE user_id=? AND type='expense' AND is_active=1 AND lower(name)='other' ORDER BY id LIMIT 1").get(LOCAL_USER_ID) as { id: number } | undefined;
  if (!other) {
    const result = db.prepare("INSERT INTO categories (user_id, name, type, is_active, sort_order, created_at) VALUES (?, 'Other', 'expense', 1, 9999, ?)").run(LOCAL_USER_ID, nowIso());
    other = { id: Number(result.lastInsertRowid) };
  }
  return other.id;
}

/**
 * Remembers an explicit choice for the exact description and, when the
 * description yields a non-generic merchant key, for that merchant (last choice
 * wins). Only rules are written: categories already stored on other movements
 * are never rewritten here.
 */
export function rememberImportCategory(description: string, categoryId: number) {
  const db = getDb();
  const valid = db.prepare("SELECT id FROM categories WHERE id=? AND user_id=? AND type='expense' AND is_active=1").get(categoryId, LOCAL_USER_ID);
  if (!valid) throw new Error("Invalid category.");
  const key = exactRuleKey(description);
  if (!key) throw new Error("Empty description.");
  const upsert = db.prepare("INSERT INTO import_category_rules (description_key, category_id) VALUES (?, ?) ON CONFLICT(description_key) DO UPDATE SET category_id=excluded.category_id");
  upsert.run(key, categoryId);
  const merchantRule = merchantRuleKey(description);
  if (merchantRule !== null) upsert.run(merchantRule, categoryId);
}

export function setTransactionCategory(id: number, categoryId: number) {
  migrate();
  const db = getDb();
  const row = db.prepare("SELECT description FROM transactions WHERE id=? AND user_id=? AND kind='purchase'").get(id, LOCAL_USER_ID) as { description: string } | undefined;
  if (!row) throw new Error("Invalid transaction.");
  db.exec("BEGIN IMMEDIATE");
  try { rememberImportCategory(row.description, categoryId); db.prepare("UPDATE transactions SET category_id=? WHERE id=? AND user_id=?").run(categoryId, id, LOCAL_USER_ID); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function insertImportedTransaction(input: {
  txnDate: string;
  description: string;
  currencyCode: string;
  amountMinor: number;
  categoryId?: number | null;
  kind?: TransactionKind;
  cardNetwork?: string | null;
  cardLast4?: string | null;
  source: string;
  messageId: string;
  rawExcerpt?: string | null;
  status?: "confirmed" | "pending";
  senderAuth?: SenderAuthVerdict | null;
}): { inserted: boolean } {
  migrate();
  const result = getDb()
    .prepare(`
      INSERT INTO transactions (
        user_id, txn_date, description, currency_code, amount_minor, category_id,
        card_network, card_last4, source, message_id, raw_excerpt, status, created_at, kind, sender_auth
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, message_id) DO NOTHING
    `)
    .run(
      LOCAL_USER_ID,
      input.txnDate,
      input.description,
      input.currencyCode,
      input.amountMinor,
      input.categoryId ?? (input.kind === "transfer_out" || input.kind === "transfer_in" ? null : automaticImportCategory(input.description)),
      input.cardNetwork ?? null,
      input.cardLast4 ?? null,
      input.source,
      input.messageId,
      input.rawExcerpt ?? null,
      input.status ?? "confirmed",
      nowIso(),
      input.kind ?? "purchase",
      input.senderAuth ?? null
    );

  return { inserted: result.changes > 0 };
}

export function listTransactions(limit = 200): Transaction[] {
  migrate();
  const rows = getDb()
    .prepare(`
      SELECT t.id, t.user_id, t.txn_date, t.description, t.currency_code, t.amount_minor, t.category_id,
        t.card_network, t.card_last4, t.source, t.message_id, t.raw_excerpt, t.kind,
        COALESCE(r.decision, t.status) AS status, t.created_at, t.sender_auth
      FROM transactions t
      LEFT JOIN transaction_reviews r ON r.transaction_id = t.id
      WHERE t.user_id = ?
      ORDER BY t.txn_date DESC, t.id DESC
      LIMIT ?
    `)
    .all(LOCAL_USER_ID, limit) as Array<{
    id: number;
    user_id: string;
    txn_date: string;
    description: string;
    currency_code: string;
    amount_minor: number;
    category_id: number | null;
    kind: TransactionKind;
    card_network: string | null;
    card_last4: string | null;
    source: string;
    message_id: string | null;
    raw_excerpt: string | null;
    status: TransactionStatus;
    created_at: string;
    sender_auth: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    txnDate: row.txn_date,
    description: row.description,
    currencyCode: row.currency_code,
    amountMinor: row.amount_minor,
    categoryId: row.category_id,
    kind: row.kind,
    cardNetwork: row.card_network,
    cardLast4: row.card_last4,
    source: row.source,
    messageId: row.message_id,
    rawExcerpt: row.raw_excerpt,
    status: row.status,
    createdAt: row.created_at,
    senderAuth: isSenderAuthVerdict(row.sender_auth) ? row.sender_auth : null
  }));
}

/** Keep review decisions without deleting the original import or its idempotency key. */
export function reviewImportedTransaction(id: number, decision: "confirmed" | "discarded") {
  if (!Number.isSafeInteger(id) || id <= 0 || !["confirmed", "discarded"].includes(decision)) {
    throw new Error("Invalid review decision.");
  }
  migrate();
  const result = getDb().prepare(`
    INSERT INTO transaction_reviews (transaction_id, decision, reviewed_at)
    SELECT id, ?, ? FROM transactions WHERE id = ? AND user_id = ?
    ON CONFLICT(transaction_id) DO UPDATE SET decision = excluded.decision, reviewed_at = excluded.reviewed_at
  `).run(decision, nowIso(), id, LOCAL_USER_ID);
  if (result.changes !== 1) throw new Error("Transaction not found.");
}

/** Records the outcome of an ingest run for observability and the staleness watchdog. */
export function recordIngestRun(input: {
  source: string;
  startedAt: string;
  messagesSeen: number;
  inserted: number;
  skipped: number;
  status: "ok" | "error";
  error?: string | null;
}) {
  migrate();
  getDb()
    .prepare(`
      INSERT INTO ingest_runs (
        source, started_at, finished_at, messages_seen, inserted, skipped, status, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.source,
      input.startedAt,
      nowIso(),
      input.messagesSeen,
      input.inserted,
      input.skipped,
      input.status,
      input.error ?? null
    );
}

export function getIngestCursor(mailboxKey: string): { uidValidity: string; lastUid: number } | null {
  migrate();
  const row = getDb().prepare("SELECT uid_validity, last_uid FROM ingest_cursors WHERE mailbox_key = ?").get(mailboxKey) as { uid_validity: string; last_uid: number } | undefined;
  return row ? { uidValidity: row.uid_validity, lastUid: row.last_uid } : null;
}

export function saveIngestCursor(mailboxKey: string, uidValidity: string, lastUid: number): void {
  if (!Number.isSafeInteger(lastUid) || lastUid < 0) throw new Error("Invalid ingest cursor.");
  migrate();
  getDb().prepare(`INSERT INTO ingest_cursors (mailbox_key, uid_validity, last_uid) VALUES (?, ?, ?)
    ON CONFLICT(mailbox_key) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid`).run(mailboxKey, uidValidity, lastUid);
}

export function latestItauIngestRun(): { finishedAt: string | null; status: string; messagesSeen: number; inserted: number; skipped: number } | null {
  migrate();
  // Only IMAP runs (`itau_email`). Rows from the removed Gmail API path (`gmail_api`) stay in the table but are not read.
  const row = getDb().prepare("SELECT finished_at, status, messages_seen, inserted, skipped FROM ingest_runs WHERE source = ? ORDER BY id DESC LIMIT 1").get("itau_email") as { finished_at: string | null; status: string; messages_seen: number; inserted: number; skipped: number } | undefined;
  return row ? { finishedAt: row.finished_at, status: row.status, messagesSeen: row.messages_seen, inserted: row.inserted, skipped: row.skipped } : null;
}
