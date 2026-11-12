"use server";

import { redirect } from "next/navigation";
import { isPasswordConfigured, setUserPassword, signIn, signOut, verifyCredentials } from "@/src/auth/session";
import type { LoginErrorCode } from "@/src/actions/error-codes";

const MIN_PASSWORD_LENGTH = 8;

export async function loginAction(formData: FormData) {
  const username = readRequiredString(formData.get("username"));
  const password = readRequiredString(formData.get("password"));

  // One code for "no such user" and "wrong password": the response must not
  // reveal which usernames exist.
  if (!verifyCredentials(username, password)) {
    redirectWithLoginError("invalid-credentials");
  }

  await signIn();
  redirect("/");
}

export async function initializePasswordAction(formData: FormData) {
  if (isPasswordConfigured()) {
    redirect("/login");
  }

  const password = readRequiredString(formData.get("password"));
  const confirmPassword = readRequiredString(formData.get("confirmPassword"));

  // eslint-disable-next-line security/detect-possible-timing-attacks -- false positive: compares two values the same user submitted in this request; no stored secret is involved. Real credential checks use crypto.timingSafeEqual in src/auth/session.ts
  if (password !== confirmPassword) {
    redirectWithLoginError("password-mismatch");
  }

  // Same rule as setUserPassword, checked here so the page can show a specific
  // message without echoing the exception text.
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirectWithLoginError("weak-password");
  }

  try {
    setUserPassword(password);
    await signIn();
  } catch {
    redirectWithLoginError("setup-failed");
  }

  redirect("/");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

function readRequiredString(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    redirectWithLoginError("missing-field");
  }

  return value.trim();
}

function redirectWithLoginError(code: LoginErrorCode): never {
  redirect(`/login?error=${code}`);
}
