"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { createRecurringExpenseFromTransaction, deleteContact, reviewImportedTransaction, saveContactForTransaction } from "@/src/db/repository";

export async function reviewTransactionAction(formData: FormData) {
  if (!await getCurrentSession()) redirect("/login");

  const rawId = formData.get("id");
  const decision = formData.get("decision");
  const id = typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0 || (decision !== "confirmed" && decision !== "discarded")) {
    redirect("/transactions?error=Invalid+review+decision.");
  }

  try {
    reviewImportedTransaction(id, decision);
    revalidatePath("/transactions");
  } catch {
    redirect("/transactions?error=Could+not+save+the+review.");
  }
  redirect("/transactions");
}

/**
 * "Make recurring": a monthly expense from one movement. Only the id, name, category and FX rate come
 * from the form; amount, currency, date and the match key are re-read from the stored movement.
 */
export async function makeRecurringAction(formData: FormData) {
  if (!await getCurrentSession()) redirect("/login");

  const id = Number(formData.get("id"));
  const categoryId = Number(formData.get("categoryId"));
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const rawFx = formData.get("fxRateToBase");
  const fx = typeof rawFx === "string" && rawFx.trim() !== "" ? Number(rawFx.replace(",", ".")) : null;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(categoryId) || categoryId <= 0 || name === "" || name.length > 120 || (fx !== null && !Number.isFinite(fx))) {
    redirect("/transactions?error=Could+not+make+recurring.");
  }

  try {
    createRecurringExpenseFromTransaction({ transactionId: id, description: name, categoryId, fxRateToBase: fx });
    revalidatePath("/transactions");
    revalidatePath("/expenses");
    revalidatePath("/");
  } catch (error) {
    redirect(error instanceof Error && error.message === "Already recurring." ? "/transactions?error=Already+recurring." : "/transactions?error=Could+not+make+recurring.");
  }
  redirect("/transactions");
}

/** Names a transfer destination ("Name"). Only the transfer id, name and own-account flag come from the form. */
export async function saveContactAction(formData: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const id = Number(formData.get("id"));
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || name === "" || name.length > 80) redirect("/transactions?error=Could+not+save+contact.");
  try {
    saveContactForTransaction(id, name, formData.get("isOwn") === "yes");
    revalidatePath("/transactions");
  } catch {
    redirect("/transactions?error=Could+not+save+contact.");
  }
  redirect("/transactions");
}

export async function deleteContactAction(formData: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const id = Number(formData.get("contactId"));
  if (!Number.isSafeInteger(id) || id <= 0) redirect("/transactions?error=Could+not+save+contact.");
  deleteContact(id);
  revalidatePath("/transactions");
  redirect("/transactions");
}
