"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/auth/session";
import { reviewImportedTransaction } from "@/src/db/repository";

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
