import { integer, primaryKey, real, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

// Declarative mirror of the raw SQL in `migrate()` (src/db/repository.ts), which is
// the runtime source of truth. Nothing imports this file at runtime; keep it in step
// with that SQL by hand until MEJ-001 (Drizzle Kit migrations) replaces it.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  createdAt: text("created_at").notNull()
});

export const currencies = sqliteTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  minorUnit: integer("minor_unit").notNull(),
  isBase: integer("is_base", { mode: "boolean" }).notNull().default(false)
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const expenseGroups = sqliteTable("expense_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const incomeItems = sqliteTable("income_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  description: text("description").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  amountMinor: integer("amount_minor").notNull(),
  fxRateToBase: real("fx_rate_to_base"),
  frequency: text("frequency", {
    enum: ["weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"]
  }).notNull().default("monthly"),
  customInterval: integer("custom_interval"),
  customUnit: text("custom_unit", { enum: ["weeks", "months", "years"] }),
  customAnchor: text("custom_anchor", { enum: ["day_of_month", "day_of_week"] }),
  customDayOfMonth: integer("custom_day_of_month"),
  customDayOfWeek: integer("custom_day_of_week"),
  startDate: text("start_date").notNull().default("1970-01-01"),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const recurringExpenses = sqliteTable("recurring_expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  groupId: integer("group_id").references(() => expenseGroups.id),
  description: text("description").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  amountMinor: integer("amount_minor").notNull(),
  fxRateToBase: real("fx_rate_to_base"),
  frequency: text("frequency", {
    enum: ["weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"]
  }).notNull(),
  customInterval: integer("custom_interval"),
  customUnit: text("custom_unit", { enum: ["weeks", "months", "years"] }),
  customAnchor: text("custom_anchor", { enum: ["day_of_month", "day_of_week"] }),
  customDayOfMonth: integer("custom_day_of_month"),
  customDayOfWeek: integer("custom_day_of_week"),
  isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    txnDate: text("txn_date").notNull(),
    description: text("description").notNull(),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amountMinor: integer("amount_minor").notNull(),
    categoryId: integer("category_id").references(() => categories.id),
    kind: text("kind", { enum: ["purchase", "transfer_out", "transfer_in"] }).notNull().default("purchase"),
    cardNetwork: text("card_network"),
    cardLast4: text("card_last4"),
    source: text("source").notNull().default("itau_email"),
    messageId: text("message_id"),
    rawExcerpt: text("raw_excerpt"),
    status: text("status", { enum: ["confirmed", "pending"] }).notNull().default("confirmed"),
    createdAt: text("created_at").notNull(),
    // MEJ-002 observation mode: NULL for rows imported before the verdict was recorded.
    senderAuth: text("sender_auth", { enum: ["pass", "fail", "none"] })
  },
  (table) => ({
    userMessage: uniqueIndex("transactions_user_message_idx").on(table.userId, table.messageId)
  })
);

export const transactionReviews = sqliteTable("transaction_reviews", {
  transactionId: integer("transaction_id").primaryKey().references(() => transactions.id, { onDelete: "cascade" }),
  decision: text("decision", { enum: ["confirmed", "discarded"] }).notNull(),
  reviewedAt: text("reviewed_at").notNull()
});

export const ingestRuns = sqliteTable("ingest_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  messagesSeen: integer("messages_seen").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error")
});

export const monthlySnapshots = sqliteTable(
  "monthly_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    totalIncomeBaseMinor: integer("total_income_base_minor").notNull(),
    totalExpenseBaseMinor: integer("total_expense_base_minor").notNull(),
    netBaseMinor: integer("net_base_minor").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    // Inline UNIQUE(user_id, month) in the SQL, not a named index.
    userMonth: unique().on(table.userId, table.month)
  })
);

export const financialPlans = sqliteTable("financial_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  targetDate: text("target_date").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  targetAmountMinor: integer("target_amount_minor").notNull(),
  fxRateToBase: real("fx_rate_to_base"),
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const planItems = sqliteTable("plan_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: integer("plan_id").notNull().references(() => financialPlans.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  amountMinor: integer("amount_minor").notNull(),
  fxRateToBase: real("fx_rate_to_base"),
  isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const ingestCursors = sqliteTable("ingest_cursors", {
  mailboxKey: text("mailbox_key").primaryKey(),
  uidValidity: text("uid_validity").notNull(),
  lastUid: integer("last_uid").notNull()
});

export const importPairExclusions = sqliteTable(
  "import_pair_exclusions",
  {
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull(),
    expenseId: integer("expense_id").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.transactionId, table.accountId, table.expenseId] })
  })
);

export const importPairConfirmations = sqliteTable(
  "import_pair_confirmations",
  {
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull(),
    expenseId: integer("expense_id").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.transactionId, table.accountId, table.expenseId] }),
    oneTransaction: uniqueIndex("import_pair_confirmations_transaction_idx").on(table.transactionId),
    oneExpense: uniqueIndex("import_pair_confirmations_expense_idx").on(table.accountId, table.expenseId)
  })
);

export const splitwiseSyncAccount = sqliteTable("splitwise_sync_account", {
  singleton: integer("singleton").primaryKey(),
  accountId: integer("account_id").notNull(),
  syncedAt: text("synced_at").notNull(),
  updatedWatermark: text("updated_watermark"),
  fullSyncedAt: text("full_synced_at")
});

export const splitwiseImports = sqliteTable(
  "splitwise_imports",
  {
    accountId: integer("account_id").notNull(),
    expenseId: integer("expense_id").notNull(),
    txnDate: text("txn_date").notNull(),
    description: text("description").notNull(),
    currency: text("currency").notNull(),
    total: text("total").notNull(),
    paid: text("paid"),
    owed: text("owed"),
    payment: integer("payment", { mode: "boolean" }).notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull(),
    categoryId: integer("category_id").references(() => categories.id)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.accountId, table.expenseId] })
  })
);

export const importCategoryRules = sqliteTable("import_category_rules", {
  descriptionKey: text("description_key").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => categories.id)
});

export const splitwiseBalanceObservations = sqliteTable(
  "splitwise_balance_observations",
  {
    accountId: integer("account_id").notNull(),
    observedAt: text("observed_at").notNull(),
    friendId: integer("friend_id").notNull(),
    person: text("person").notNull(),
    currency: text("currency").notNull(),
    amount: text("amount").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.accountId, table.observedAt, table.friendId, table.currency] })
  })
);

export const splitwiseActivityEvents = sqliteTable(
  "splitwise_activity_events",
  {
    accountId: integer("account_id").notNull(),
    eventId: integer("event_id").notNull(),
    occurredAt: text("occurred_at").notNull(),
    observedAt: text("observed_at").notNull(),
    eventType: integer("event_type").notNull(),
    expenseId: integer("expense_id").notNull(),
    actorId: integer("actor_id")
  },
  (table) => ({
    pk: primaryKey({ columns: [table.accountId, table.eventId] })
  })
);

export const splitwiseActivitySync = sqliteTable("splitwise_activity_sync", {
  accountId: integer("account_id").primaryKey(),
  firstObservedAt: text("first_observed_at").notNull(),
  lastObservedAt: text("last_observed_at").notNull()
});

export const openingBalances = sqliteTable(
  "opening_balances",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amountMinor: integer("amount_minor").notNull(),
    asOfDate: text("as_of_date").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.currencyCode] })
  })
);

export const balanceAdjustments = sqliteTable("balance_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  amountMinor: integer("amount_minor").notNull(),
  adjustmentDate: text("adjustment_date").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull()
});
