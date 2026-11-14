"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { FormError, formErrorCode } from "@/src/actions/error-codes";
import {
  addBalanceAdjustment,
  clearOpeningBalance,
  deleteBalanceAdjustment,
  listCurrencies,
  setOpeningBalance,
  type Currency
} from "@/src/db/repository";
import { dateOnly } from "@/src/finance/dates";
import { parseSignedMoneyToMinor } from "@/src/finance/money";

const PAGE = "/balance";

/** Session check, then the write; any validation failure redirects with a fixed code (MEJ-007). */
async function run(write: () => void): Promise<never> {
  if (!(await getCurrentSession())) redirect("/login");
  try {
    write();
    revalidatePath("/");
    revalidatePath(PAGE);
  } catch (error) {
    redirect(`${PAGE}?error=${formErrorCode(error)}`);
  }
  redirect(PAGE);
}

export async function saveOpeningBalanceAction(form: FormData) {
  await run(() => {
    const currency = requireCurrency(form.get("currencyCode"));
    setOpeningBalance({
      currencyCode: currency.code,
      amountMinor: requireAmount(form.get("amount"), currency, true),
      asOfDate: requirePastDate(form.get("asOfDate"))
    });
  });
}

export async function clearOpeningBalanceAction(form: FormData) {
  await run(() => clearOpeningBalance(requireCurrency(form.get("currencyCode")).code));
}

export async function addBalanceAdjustmentAction(form: FormData) {
  await run(() => {
    const currency = requireCurrency(form.get("currencyCode"));
    const note = form.get("note");
    if (typeof note !== "string" || note.trim() === "") throw new FormError("missing-field", "Note");
    addBalanceAdjustment({
      currencyCode: currency.code,
      amountMinor: requireAmount(form.get("amount"), currency, false),
      adjustmentDate: requirePastDate(form.get("adjustmentDate")),
      note: note.trim().slice(0, 500)
    });
  });
}

export async function deleteBalanceAdjustmentAction(form: FormData) {
  await run(() => {
    const id = Number(form.get("id"));
    if (!Number.isSafeInteger(id) || id <= 0) throw new FormError("invalid-number", "Adjustment id");
    deleteBalanceAdjustment(id);
  });
}

function requireCurrency(value: FormDataEntryValue | null): Currency {
  if (typeof value !== "string" || value.trim() === "") throw new FormError("missing-field", "Currency");
  const currency = listCurrencies().find((item) => item.code === value.trim());
  if (!currency) throw new FormError("unknown-currency");
  return currency;
}

function requireAmount(value: FormDataEntryValue | null, currency: Currency, allowZero: boolean): number {
  if (typeof value !== "string" || value.trim() === "") throw new FormError("missing-field", "Amount");
  let amountMinor: number;
  try {
    amountMinor = parseSignedMoneyToMinor(value, currency.minorUnit);
  } catch {
    throw new FormError("invalid-signed-amount");
  }
  if (!allowZero && amountMinor === 0) throw new FormError("invalid-signed-amount");
  return amountMinor;
}

/** A real calendar day, not after today (UTC, the same convention as the imported records). */
function requirePastDate(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FormError("invalid-date");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value || value > dateOnly(new Date())) {
    throw new FormError("invalid-date");
  }
  return value;
}
