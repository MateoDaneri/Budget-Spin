"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deactivateCategory,
  deactivateExpenseGroup,
  deleteFinancialPlan,
  deleteIncomeItem,
  deletePlanItem,
  deleteRecurringExpense,
  getBaseCurrency,
  listCurrencies,
  reorderExpenseCategories,
  saveCurrency,
  setBaseCurrency,
  setPlanItemDone,
  upsertCategory,
  upsertExpenseGroup,
  upsertFinancialPlan,
  upsertIncomeItem,
  upsertPlanItem,
  upsertRecurringExpense,
  type CategoryType,
  type CustomRecurrenceAnchor,
  type CustomRecurrenceUnit,
  type Frequency
} from "@/src/db/repository";
import { parseMoneyToMinor } from "@/src/finance/money";

export async function saveCategoryAction(formData: FormData) {
  try {
    const id = optionalNumber(formData.get("id"));
    const name = requiredString(formData.get("name"), "Category name");
    const type = requiredEnum<CategoryType>(formData.get("type"), ["income", "expense"], "Category type");

    upsertCategory({ id, name, type });
    revalidatePath("/");
    revalidatePath("/categories");
  } catch (error) {
    redirectWithError("/categories", error);
  }

  redirect("/categories");
}

export async function deactivateCategoryAction(formData: FormData) {
  try {
    deactivateCategory(requiredNumber(formData.get("id"), "Category id"));
    revalidatePath("/");
    revalidatePath("/categories");
  } catch (error) {
    redirectWithError("/categories", error);
  }

  redirect("/categories");
}

export async function saveExpenseGroupAction(formData: FormData) {
  try {
    upsertExpenseGroup({
      id: optionalNumber(formData.get("id")),
      name: requiredString(formData.get("name"), "Family name")
    });
    revalidatePath("/");
    revalidatePath("/expenses");
  } catch (error) {
    redirectWithError("/expenses", error);
  }

  redirect("/expenses");
}

export async function deactivateExpenseGroupAction(formData: FormData) {
  try {
    deactivateExpenseGroup(requiredNumber(formData.get("id"), "Family id"));
    revalidatePath("/");
    revalidatePath("/expenses");
  } catch (error) {
    redirectWithError("/expenses", error);
  }

  redirect("/expenses");
}

export async function saveIncomeAction(formData: FormData) {
  try {
    const currencies = listCurrencies();
    const baseCurrency = getBaseCurrency();
    const currencyCode = requiredString(formData.get("currencyCode"), "Currency");
    const currency = currencies.find((item) => item.code === currencyCode);

    if (!currency) {
      throw new Error("Unknown currency.");
    }

    const fxRateToBase = parseFxRate(formData.get("fxRateToBase"), currencyCode, baseCurrency.code);
    const endDate = optionalString(formData.get("endDate"));
    const frequency = requiredEnum<Frequency>(
      formData.get("frequency"),
      ["weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"],
      "Frequency"
    );
    const customRecurrence = parseCustomRecurrence(formData, frequency);

    upsertIncomeItem({
      id: optionalNumber(formData.get("id")),
      categoryId: requiredNumber(formData.get("categoryId"), "Category"),
      description: requiredString(formData.get("description"), "Description"),
      currencyCode,
      amountMinor: parseMoneyToMinor(requiredString(formData.get("amount"), "Amount"), currency.minorUnit),
      fxRateToBase,
      frequency,
      ...customRecurrence,
      startDate: requiredString(formData.get("startDate"), "Start date"),
      endDate
    });

    revalidatePath("/");
    revalidatePath("/income");
  } catch (error) {
    redirectWithError("/income", error);
  }

  redirect("/income");
}

export async function deleteIncomeAction(formData: FormData) {
  try {
    deleteIncomeItem(requiredNumber(formData.get("id"), "Income id"));
    revalidatePath("/");
    revalidatePath("/income");
  } catch (error) {
    redirectWithError("/income", error);
  }

  redirect("/income");
}

export async function saveExpenseAction(formData: FormData) {
  try {
    const currencies = listCurrencies();
    const baseCurrency = getBaseCurrency();
    const currencyCode = requiredString(formData.get("currencyCode"), "Currency");
    const currency = currencies.find((item) => item.code === currencyCode);

    if (!currency) {
      throw new Error("Unknown currency.");
    }

    const fxRateToBase = parseFxRate(formData.get("fxRateToBase"), currencyCode, baseCurrency.code);
    const endDate = optionalString(formData.get("endDate"));
    const frequency = requiredEnum<Frequency>(
      formData.get("frequency"),
      ["weekly", "biweekly", "monthly", "quarterly", "yearly", "custom"],
      "Frequency"
    );
    const customRecurrence = parseCustomRecurrence(formData, frequency);

    upsertRecurringExpense({
      id: optionalNumber(formData.get("id")),
      categoryId: requiredNumber(formData.get("categoryId"), "Category"),
      groupId: requiredNumber(formData.get("groupId"), "Family"),
      description: requiredString(formData.get("description"), "Description"),
      currencyCode,
      amountMinor: parseMoneyToMinor(requiredString(formData.get("amount"), "Amount"), currency.minorUnit),
      fxRateToBase,
      frequency,
      ...customRecurrence,
      isOptional: optionalString(formData.get("isOptional")) === "true",
      startDate: requiredString(formData.get("startDate"), "Start date"),
      endDate
    });

    revalidatePath("/");
    revalidatePath("/expenses");
  } catch (error) {
    redirectWithError("/expenses", error);
  }

  redirect("/expenses");
}

export async function deleteExpenseAction(formData: FormData) {
  try {
    deleteRecurringExpense(requiredNumber(formData.get("id"), "Expense id"));
    revalidatePath("/");
    revalidatePath("/expenses");
  } catch (error) {
    redirectWithError("/expenses", error);
  }

  redirect("/expenses");
}

export async function reorderExpenseCategoriesAction(categoryIds: number[]) {
  reorderExpenseCategories(categoryIds);
  revalidatePath("/");
  revalidatePath("/expenses");
}

export async function saveCurrencySettingsAction(formData: FormData) {
  const newCode = optionalString(formData.get("newCode"));

  if (newCode) {
    saveCurrency({
      code: newCode.toUpperCase(),
      name: requiredString(formData.get("newName"), "Currency name"),
      symbol: requiredString(formData.get("newSymbol"), "Currency symbol"),
      minorUnit: requiredNumber(formData.get("newMinorUnit"), "Minor unit"),
      isBase: false
    });
  }

  setBaseCurrency(requiredString(formData.get("baseCurrency"), "Base currency"));
  revalidatePath("/");
  revalidatePath("/setup");
  redirect("/setup");
}

export async function savePlanAction(formData: FormData) {
  try {
    const currencies = listCurrencies();
    const baseCurrency = getBaseCurrency();
    const currencyCode = requiredString(formData.get("currencyCode"), "Currency");
    const currency = currencies.find((item) => item.code === currencyCode);

    if (!currency) {
      throw new Error("Unknown currency.");
    }

    upsertFinancialPlan({
      id: optionalNumber(formData.get("id")),
      name: requiredString(formData.get("name"), "Plan name"),
      targetDate: requiredString(formData.get("targetDate"), "Target date"),
      currencyCode,
      targetAmountMinor: parseMoneyToMinor(requiredString(formData.get("targetAmount"), "Target amount"), currency.minorUnit),
      fxRateToBase: parseFxRate(formData.get("fxRateToBase"), currencyCode, baseCurrency.code),
      notes: optionalString(formData.get("notes"))
    });

    revalidatePath("/plans");
  } catch (error) {
    redirectWithError("/plans", error);
  }

  redirect("/plans");
}

export async function deletePlanAction(formData: FormData) {
  try {
    deleteFinancialPlan(requiredNumber(formData.get("id"), "Plan id"));
    revalidatePath("/plans");
  } catch (error) {
    redirectWithError("/plans", error);
  }

  redirect("/plans");
}

export async function savePlanItemAction(formData: FormData) {
  const planId = requiredNumber(formData.get("planId"), "Plan id");

  try {
    const currencies = listCurrencies();
    const baseCurrency = getBaseCurrency();
    const currencyCode = requiredString(formData.get("currencyCode"), "Currency");
    const currency = currencies.find((item) => item.code === currencyCode);

    if (!currency) {
      throw new Error("Unknown currency.");
    }

    upsertPlanItem({
      id: optionalNumber(formData.get("id")),
      planId,
      description: requiredString(formData.get("description"), "Description"),
      currencyCode,
      amountMinor: parseMoneyToMinor(requiredString(formData.get("amount"), "Amount"), currency.minorUnit),
      fxRateToBase: parseFxRate(formData.get("fxRateToBase"), currencyCode, baseCurrency.code),
      isDone: optionalString(formData.get("isDone")) === "true"
    });

    revalidatePath("/plans");
  } catch (error) {
    redirectWithError("/plans", error);
  }

  redirect(`/plans#plan-${planId}`);
}

export async function togglePlanItemAction(formData: FormData) {
  const planId = requiredNumber(formData.get("planId"), "Plan id");

  try {
    setPlanItemDone(
      requiredNumber(formData.get("id"), "Plan item id"),
      optionalString(formData.get("isDone")) === "true"
    );
    revalidatePath("/plans");
  } catch (error) {
    redirectWithError("/plans", error);
  }

  redirect(`/plans#plan-${planId}`);
}

export async function deletePlanItemAction(formData: FormData) {
  const planId = requiredNumber(formData.get("planId"), "Plan id");

  try {
    deletePlanItem(requiredNumber(formData.get("id"), "Plan item id"));
    revalidatePath("/plans");
  } catch (error) {
    redirectWithError("/plans", error);
  }

  redirect(`/plans#plan-${planId}`);
}

function parseFxRate(value: FormDataEntryValue | null, currencyCode: string, baseCurrencyCode: string) {
  if (currencyCode === baseCurrencyCode) {
    return null;
  }

  const raw = requiredString(value, `FX rate from ${currencyCode} to ${baseCurrencyCode}`).replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`FX rate from ${currencyCode} to ${baseCurrencyCode} must be greater than zero.`);
  }

  return parsed;
}

function parseCustomRecurrence(formData: FormData, frequency: Frequency) {
  if (frequency !== "custom") {
    return {
      customInterval: null,
      customUnit: null,
      customAnchor: null,
      customDayOfMonth: null,
      customDayOfWeek: null
    };
  }

  const customInterval = requiredNumber(formData.get("customInterval"), "Custom interval");
  if (customInterval < 1 || customInterval > 120) {
    throw new Error("Custom interval must be between 1 and 120.");
  }

  const customUnit = requiredEnum<CustomRecurrenceUnit>(formData.get("customUnit"), ["weeks", "months", "years"], "Custom unit");
  const customAnchor = requiredEnum<CustomRecurrenceAnchor>(
    formData.get("customAnchor"),
    ["day_of_month", "day_of_week"],
    "Custom anchor"
  );

  if (customUnit === "weeks" && customAnchor !== "day_of_week") {
    throw new Error("Custom weekly recurrence must use a day of week.");
  }

  const customDayOfMonth =
    customAnchor === "day_of_month" ? boundedNumber(formData.get("customDayOfMonth"), "Custom day of month", 1, 31) : null;
  const customDayOfWeek =
    customAnchor === "day_of_week" ? boundedNumber(formData.get("customDayOfWeek"), "Custom day of week", 0, 6) : null;

  return {
    customInterval,
    customUnit,
    customAnchor,
    customDayOfMonth,
    customDayOfWeek
  };
}

function requiredString(value: FormDataEntryValue | null, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function optionalString(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function requiredNumber(value: FormDataEntryValue | null, label: string) {
  const raw = requiredString(value, label);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }

  return parsed;
}

function boundedNumber(value: FormDataEntryValue | null, label: string, min: number, max: number) {
  const parsed = requiredNumber(value, label);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error("Expected integer id.");
  }

  return parsed;
}

function requiredEnum<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[], label: string): T {
  const raw = requiredString(value, label);
  if (!allowed.includes(raw as T)) {
    throw new Error(`${label} is invalid.`);
  }

  return raw as T;
}

function redirectWithError(pathname: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Unexpected form error.";
  redirect(`${pathname}?error=${encodeURIComponent(message)}`);
}
