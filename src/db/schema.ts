import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull()
});

export const expenseGroups = sqliteTable("expense_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const incomeItems = sqliteTable("income_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
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
  userId: text("user_id").notNull().references(() => users.id),
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

export const monthlySnapshots = sqliteTable(
  "monthly_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull().references(() => users.id),
    month: text("month").notNull(),
    totalIncomeBaseMinor: integer("total_income_base_minor").notNull(),
    totalExpenseBaseMinor: integer("total_expense_base_minor").notNull(),
    netBaseMinor: integer("net_base_minor").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    userMonth: uniqueIndex("monthly_snapshots_user_month_idx").on(table.userId, table.month)
  })
);

export const financialPlans = sqliteTable("financial_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id),
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
  userId: text("user_id").notNull().references(() => users.id),
  planId: integer("plan_id").notNull().references(() => financialPlans.id),
  description: text("description").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  amountMinor: integer("amount_minor").notNull(),
  fxRateToBase: real("fx_rate_to_base"),
  isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
