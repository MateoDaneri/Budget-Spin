import { getDb } from "./client";

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
  `);

  ensureUserAuthColumns();
  migrateLegacyLocalUser();
  ensureColumn("recurring_expenses", "is_optional", "INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1))");
  ensureCategorySortOrder();
  ensureIncomeItemsRecurrenceColumns();
  ensureRecurringExpensesCustomSchema();

  seedDefaults();
  ensureRecurringExpensesGroupColumn();
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

export function deactivateExpenseGroup(id: number) {
  migrate();
  const defaultGroupId = getDefaultExpenseGroupId();

  if (id === defaultGroupId) {
    throw new Error("The General expense family cannot be deactivated.");
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
