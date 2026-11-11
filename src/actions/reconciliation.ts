"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { setPairExclusion } from "@/src/splitwise/store";
export async function setPairExclusionAction(form: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const bank = Number(form.get("bank")), shared = Number(form.get("shared"));
  const month = String(form.get("month") ?? "");
  const choice = form.get("exclude");
  if (choice !== "yes" && choice !== "no") redirect("/");
  const excluded = choice === "yes";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) redirect("/");
  try { setPairExclusion(bank, shared, excluded); revalidatePath("/"); }
  catch { redirect(`/?month=${month}&reconciliation=error`); }
  redirect(`/?month=${month}#actual-spending`);
}
