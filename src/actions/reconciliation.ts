"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { reconciliationErrorCode } from "@/src/actions/error-codes";
import { confirmPair, removePairConfirmation, setPairExclusion } from "@/src/splitwise/store";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Only ids and the month come from the form; amounts are always re-read from the database. */
function pairFields(form: FormData) {
  return { bank: Number(form.get("bank")), shared: Number(form.get("shared")), month: String(form.get("month") ?? "") };
}

export async function setPairExclusionAction(form: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const { bank, shared, month } = pairFields(form);
  const choice = form.get("exclude");
  if (choice !== "yes" && choice !== "no") redirect("/");
  const excluded = choice === "yes";
  if (!MONTH.test(month)) redirect("/");
  try { setPairExclusion(bank, shared, excluded); revalidatePath("/"); }
  catch (error) { redirect(`/?month=${month}&reconciliation=${reconciliationErrorCode(error)}#actual-spending`); }
  redirect(`/?month=${month}#actual-spending`);
}

/** "Same expense": stores a manual pair after server-side checks (see `confirmPair`). */
export async function confirmPairAction(form: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const { bank, shared, month } = pairFields(form);
  if (!MONTH.test(month)) redirect("/");
  try { confirmPair(bank, shared, month); revalidatePath("/"); }
  catch (error) { redirect(`/?month=${month}&reconciliation=${reconciliationErrorCode(error)}#actual-spending`); }
  redirect(`/?month=${month}#actual-spending`);
}

/** "Undo": removes a manual pair. */
export async function undoPairConfirmationAction(form: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const { bank, shared, month } = pairFields(form);
  if (!MONTH.test(month)) redirect("/");
  try { removePairConfirmation(bank, shared); revalidatePath("/"); }
  catch (error) { redirect(`/?month=${month}&reconciliation=${reconciliationErrorCode(error)}#actual-spending`); }
  redirect(`/?month=${month}#actual-spending`);
}
