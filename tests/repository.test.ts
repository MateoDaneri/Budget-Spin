import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPasswordConfigured, setUserPassword, verifyCredentials } from "@/src/auth/session";
import { closeDb, getDb } from "@/src/db/client";
import {
  LOCAL_USER_ID,
  listCategories,
  listCurrencies,
  listExpenseGroups,
  listFinancialPlans,
  listIncomeItems,
  listPlanItems,
  listRecurringExpenses,
  migrate,
  setPlanItemDone,
  upsertCategory,
  upsertExpenseGroup,
  upsertFinancialPlan,
  upsertIncomeItem,
  upsertPlanItem,
  upsertRecurringExpense
} from "@/src/db/repository";
import { calculateMonthMetrics } from "@/src/finance/metrics";
import { calculatePlanProjection } from "@/src/finance/plans";

let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `budgetspin-${crypto.randomUUID()}.sqlite`);
  process.env.DATABASE_PATH = dbPath;
  closeDb();
  migrate();
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  delete process.env.DATABASE_PATH;
});

describe("repository CRUD and metrics", () => {
  it("migrates legacy local data to the mdaneri user", () => {
    const db = getDb();
    db.prepare("INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)").run(
      "local-user",
      "legacy@budgetspin.local",
      "Legacy",
      new Date().toISOString()
    );
    db.prepare("INSERT INTO categories (user_id, name, type, is_active, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)").run(
      "local-user",
      "Legacy expense",
      "expense",
      99,
      new Date().toISOString()
    );

    migrate();

    const category = listCategories("expense", false).find((item) => item.name === "Legacy expense");
    expect(category?.userId).toBe(LOCAL_USER_ID);
    expect(db.prepare("SELECT id FROM users WHERE id = ?").get("local-user")).toBeUndefined();
  });

  it("initializes and verifies the mdaneri password", () => {
    expect(isPasswordConfigured()).toBe(false);

    setUserPassword("correct horse battery staple");

    expect(isPasswordConfigured()).toBe(true);
    expect(verifyCredentials("mdaneri", "correct horse battery staple")).toBe(true);
    expect(verifyCredentials("mdaneri", "wrong password")).toBe(false);
  });

  it("creates, updates, and deletes income through active-state queries", () => {
    const category = listCategories("income")[0];
    upsertIncomeItem({
      categoryId: category.id,
      description: "Main salary",
      currencyCode: "UYU",
      amountMinor: 12000000,
      fxRateToBase: null
    });

    let incomes = listIncomeItems();
    expect(incomes).toHaveLength(1);
    expect(incomes[0].description).toBe("Main salary");

    upsertIncomeItem({
      id: incomes[0].id,
      categoryId: category.id,
      description: "Updated salary",
      currencyCode: "UYU",
      amountMinor: 12500000,
      fxRateToBase: null
    });

    incomes = listIncomeItems();
    expect(incomes[0].description).toBe("Updated salary");
    expect(incomes[0].amountMinor).toBe(12500000);
  });

  it("projects recurring income only in matching months", () => {
    const category = listCategories("income")[0];
    upsertIncomeItem({
      categoryId: category.id,
      description: "Salary",
      currencyCode: "UYU",
      amountMinor: 6000000,
      fxRateToBase: null,
      frequency: "monthly",
      startDate: "2026-01-01",
      endDate: null
    });
    upsertIncomeItem({
      categoryId: category.id,
      description: "Aguinaldo",
      currencyCode: "UYU",
      amountMinor: 3000000,
      fxRateToBase: null,
      frequency: "custom",
      customInterval: 6,
      customUnit: "months",
      customAnchor: "day_of_month",
      customDayOfMonth: 15,
      customDayOfWeek: null,
      startDate: "2026-06-15",
      endDate: null
    });

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const juneMetrics = calculateMonthMetrics({
      month: "2026-06",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });
    const julyMetrics = calculateMonthMetrics({
      month: "2026-07",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });
    const decemberMetrics = calculateMonthMetrics({
      month: "2026-12",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });

    expect(juneMetrics.incomeBaseMinor).toBe(9000000);
    expect(julyMetrics.incomeBaseMinor).toBe(6000000);
    expect(decemberMetrics.incomeBaseMinor).toBe(9000000);
  });

  it("creates and updates recurring expenses", () => {
    const category = listCategories("expense")[0];
    upsertRecurringExpense({
      categoryId: category.id,
      description: "Rent",
      currencyCode: "UYU",
      amountMinor: 3000000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-01-01",
      endDate: null
    });

    let expenses = listRecurringExpenses();
    expect(expenses).toHaveLength(1);

    upsertRecurringExpense({
      id: expenses[0].id,
      categoryId: category.id,
      description: "Updated rent",
      currencyCode: "UYU",
      amountMinor: 3200000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-01-01",
      endDate: null
    });

    expenses = listRecurringExpenses();
    expect(expenses[0].description).toBe("Updated rent");
    expect(expenses[0].amountMinor).toBe(3200000);
  });

  it("reflects category edits in dashboard metrics", () => {
    const category = listCategories("expense")[0];
    upsertRecurringExpense({
      categoryId: category.id,
      description: "Rent",
      currencyCode: "UYU",
      amountMinor: 3000000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-01-01",
      endDate: null
    });

    upsertCategory({ id: category.id, name: "Housing Updated", type: "expense" });

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const metrics = calculateMonthMetrics({
      month: "2026-05",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });

    expect(metrics.expenseByCategory).toEqual([{ categoryName: "Housing Updated", amountBaseMinor: 3000000 }]);
  });

  it("groups recurring expenses by family in dashboard metrics", () => {
    const category = listCategories("expense")[0];
    upsertExpenseGroup({ name: "Car" });
    const group = listExpenseGroups().find((item) => item.name === "Car");
    expect(group).toBeDefined();

    upsertRecurringExpense({
      categoryId: category.id,
      groupId: group!.id,
      description: "Car payment",
      currencyCode: "UYU",
      amountMinor: 2103300,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-01-01",
      endDate: null
    });

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const metrics = calculateMonthMetrics({
      month: "2026-05",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });

    expect(metrics.expenseByGroup).toEqual([{ groupName: "Car", amountBaseMinor: 2103300 }]);
    expect(metrics.expenseWithOptionalByGroup).toEqual([{ groupName: "Car", amountBaseMinor: 2103300 }]);
  });

  it("keeps optional expenses out of the base projection and includes them in the optional scenario", () => {
    const category = listCategories("expense")[0];
    upsertRecurringExpense({
      categoryId: category.id,
      description: "Rent",
      currencyCode: "UYU",
      amountMinor: 3000000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-01-01",
      endDate: null
    });
    upsertRecurringExpense({
      categoryId: category.id,
      description: "Monthly party",
      currencyCode: "UYU",
      amountMinor: 500000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: true,
      startDate: "2026-01-01",
      endDate: null
    });

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const metrics = calculateMonthMetrics({
      month: "2026-05",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });

    expect(metrics.expenseBaseMinor).toBe(3000000);
    expect(metrics.optionalExpenseBaseMinor).toBe(500000);
    expect(metrics.expenseWithOptionalBaseMinor).toBe(3500000);
    expect(metrics.expenseByCategory).toEqual([{ categoryName: category.name, amountBaseMinor: 3000000 }]);
    expect(metrics.optionalExpenseByCategory).toEqual([{ categoryName: category.name, amountBaseMinor: 500000 }]);
    expect(metrics.expenseWithOptionalByCategory).toEqual([{ categoryName: category.name, amountBaseMinor: 3500000 }]);
  });

  it("does not include inactive-in-month expense categories in breakdowns", () => {
    const category = listCategories("expense")[0];
    upsertRecurringExpense({
      categoryId: category.id,
      description: "Future subscription",
      currencyCode: "UYU",
      amountMinor: 100000,
      fxRateToBase: null,
      frequency: "monthly",
      isOptional: false,
      startDate: "2026-06-01",
      endDate: null
    });

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const metrics = calculateMonthMetrics({
      month: "2026-05",
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!
    });

    expect(metrics.expenseBaseMinor).toBe(0);
    expect(metrics.expenseByCategory).toEqual([]);
    expect(metrics.expenseWithOptionalByCategory).toEqual([]);
  });

  it("tracks plan items and compares the remaining amount against projected net", () => {
    const incomeCategory = listCategories("income")[0];
    upsertIncomeItem({
      categoryId: incomeCategory.id,
      description: "Salary",
      currencyCode: "UYU",
      amountMinor: 6000000,
      fxRateToBase: null
    });
    upsertFinancialPlan({
      name: "August trip",
      targetDate: "2026-08-15",
      currencyCode: "USD",
      targetAmountMinor: 250000,
      fxRateToBase: 40,
      notes: null
    });

    const plan = listFinancialPlans()[0];
    upsertPlanItem({
      planId: plan.id,
      description: "Flight",
      currencyCode: "USD",
      amountMinor: 50000,
      fxRateToBase: 40,
      isDone: false
    });
    const item = listPlanItems(plan.id)[0];
    setPlanItemDone(item.id, true);

    const currencies = listCurrencies();
    const baseCurrency = currencies.find((currency) => currency.isBase);
    expect(baseCurrency).toBeDefined();

    const projection = calculatePlanProjection({
      plan,
      items: listPlanItems(plan.id),
      incomes: listIncomeItems(),
      expenses: listRecurringExpenses(),
      currencies,
      baseCurrency: baseCurrency!,
      currentMonth: "2026-06"
    });

    expect(projection.monthsToTarget).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(projection.monthlyInputs.map((input) => input.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(projection.monthlyInputs).toEqual([
      {
        month: "2026-06",
        incomeBaseMinor: 6000000,
        committedExpenseBaseMinor: 0,
        optionalExpenseBaseMinor: 0,
        committedNetBaseMinor: 6000000,
        netWithOptionalBaseMinor: 6000000
      },
      {
        month: "2026-07",
        incomeBaseMinor: 6000000,
        committedExpenseBaseMinor: 0,
        optionalExpenseBaseMinor: 0,
        committedNetBaseMinor: 6000000,
        netWithOptionalBaseMinor: 6000000
      },
      {
        month: "2026-08",
        incomeBaseMinor: 6000000,
        committedExpenseBaseMinor: 0,
        optionalExpenseBaseMinor: 0,
        committedNetBaseMinor: 6000000,
        netWithOptionalBaseMinor: 6000000
      }
    ]);
    expect(projection.targetBaseMinor).toBe(10000000);
    expect(projection.itemDoneBaseMinor).toBe(2000000);
    expect(projection.remainingBaseMinor).toBe(8000000);
    expect(projection.monthlyRequiredBaseMinor).toBe(2666667);
    expect(projection.committedAvailableBaseMinor).toBe(18000000);
    expect(projection.committedGapBaseMinor).toBe(10000000);
  });
});
