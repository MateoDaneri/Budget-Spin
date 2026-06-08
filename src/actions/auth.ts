"use server";

import { redirect } from "next/navigation";
import { isPasswordConfigured, setUserPassword, signIn, signOut, verifyCredentials } from "@/src/auth/session";

export async function loginAction(formData: FormData) {
  const username = readRequiredString(formData.get("username"), "Username");
  const password = readRequiredString(formData.get("password"), "Password");

  if (!verifyCredentials(username, password)) {
    redirect(`/login?error=${encodeURIComponent("Invalid username or password.")}`);
  }

  await signIn();
  redirect("/");
}

export async function initializePasswordAction(formData: FormData) {
  if (isPasswordConfigured()) {
    redirect("/login");
  }

  const password = readRequiredString(formData.get("password"), "Password");
  const confirmPassword = readRequiredString(formData.get("confirmPassword"), "Confirm password");

  if (password !== confirmPassword) {
    redirect(`/login?error=${encodeURIComponent("Passwords do not match.")}`);
  }

  try {
    setUserPassword(password);
    await signIn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not initialize password.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

function readRequiredString(value: FormDataEntryValue | null, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    redirect(`/login?error=${encodeURIComponent(`${label} is required.`)}`);
  }

  return value.trim();
}
