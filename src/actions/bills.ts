"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { FormError, formErrorCode } from "@/src/actions/error-codes";
import { archiveBill, listCurrencies, setBillPaid, upsertBill } from "@/src/db/repository";
import { currentMonthKey } from "@/src/finance/dates";
import { parseSignedMoneyToMinor } from "@/src/finance/money";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthOf(form: FormData): string {
  const value = form.get("month");
  return typeof value === "string" && MONTH.test(value) ? value : currentMonthKey();
}

/** Session check, then the write; failures redirect with a fixed code (MEJ-007), never free text. */
async function run(form: FormData, write: (month: string) => void): Promise<never> {
  if (!(await getCurrentSession())) redirect("/login");
  const month = monthOf(form);
  try {
    write(month);
    revalidatePath("/bills");
  } catch (error) {
    redirect(`/bills?month=${month}&error=${formErrorCode(error)}`);
  }
  redirect(`/bills?month=${month}`);
}

export async function saveBillAction(form: FormData) {
  await run(form, () => {
    const id = form.get("id");
    upsertBill({ id: id === null || id === "" ? undefined : requireId(id), ...billFields(form) });
  });
}

export async function archiveBillAction(form: FormData) {
  await run(form, () => archiveBill(requireId(form.get("id"))));
}

export async function setBillPaidAction(form: FormData) {
  await run(form, (month) => {
    const paid = form.get("paid");
    if (paid !== "yes" && paid !== "no") throw new FormError("invalid-option", "Paid");
    setBillPaid(requireId(form.get("id")), month, paid === "yes");
  });
}

function billFields(form: FormData) {
  const name = form.get("name");
  if (typeof name !== "string" || name.trim() === "") throw new FormError("missing-field", "Name");
  if (name.trim().length > 120) throw new FormError("invalid-option", "Name");

  const rawAmount = form.get("amount");
  let amountMinor: number | null = null;
  let currencyCode: string | null = null;
  if (typeof rawAmount === "string" && rawAmount.trim() !== "") {
    const code = form.get("currencyCode");
    const currency = listCurrencies().find((item) => item.code === code);
    if (!currency) throw new FormError("unknown-currency");
    try {
      amountMinor = parseSignedMoneyToMinor(rawAmount, currency.minorUnit);
    } catch {
      throw new FormError("invalid-amount");
    }
    if (amountMinor <= 0) throw new FormError("invalid-amount");
    currencyCode = currency.code;
  }

  const rawDay = form.get("dueDay");
  let dueDay: number | null = null;
  if (typeof rawDay === "string" && rawDay.trim() !== "") {
    dueDay = Number(rawDay);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new FormError("invalid-number", "Due day");
  }

  return { name: name.trim(), amountMinor, currencyCode, dueDay };
}

function requireId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new FormError("invalid-number", "Bill id");
  return id;
}
