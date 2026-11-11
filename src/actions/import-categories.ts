"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { setTransactionCategory } from "@/src/db/repository";
import { setSplitwiseCategory } from "@/src/splitwise/store";

export async function setImportCategoryAction(form: FormData) {
  if (!await getCurrentSession()) redirect("/login");
  const source = form.get("source");
  const route = source === "splitwise" ? "/splitwise" : "/transactions";
  const id = Number(form.get("id"));
  const category = Number(form.get("category"));
  if ((source !== "splitwise" && source !== "transaction") || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(category) || category <= 0) redirect(`${route}?error=Invalid+category.`);
  try {
    if (source === "splitwise") setSplitwiseCategory(id, category);
    else setTransactionCategory(id, category);
    revalidatePath("/transactions"); revalidatePath("/splitwise");
  } catch { redirect(`${route}?error=Could+not+save+category.`); }
  redirect(route);
}
