// Fixed error codes for `?error=` redirects (MEJ-007).
//
// Server actions redirect with a short code; pages translate it to a fixed
// message. The query value itself is never rendered, so a crafted link cannot
// make the app display arbitrary text, and exception details (e.g. SQLite)
// never reach the URL, browser history or proxy logs.
//
// Not a "use server" module: it exports a class and constants, which a server
// action file cannot.

export const FORM_ERROR_MESSAGES = {
  "missing-field": "A required field is missing. Fill in every required field and try again.",
  "invalid-number": "A numeric field has an invalid value.",
  "invalid-option": "One of the selected options is not valid.",
  "unknown-currency": "The selected currency is not configured.",
  "invalid-amount": "Amount must be a positive decimal number.",
  "invalid-fx-rate": "Enter an FX rate greater than zero for the selected currency.",
  "invalid-recurrence": "The custom recurrence is not valid. Check the interval (1 to 120) and the day.",
  "general-family-locked": "The General expense family cannot be deactivated."
} as const;

export type FormErrorCode = keyof typeof FORM_ERROR_MESSAGES | "unexpected";

export const GENERIC_FORM_ERROR = "Something went wrong. Please try again.";

export const LOGIN_ERROR_MESSAGES = {
  // Same text whether the user does not exist or the password is wrong.
  "invalid-credentials": "Invalid username or password.",
  "missing-field": "Fill in every field.",
  "password-mismatch": "Passwords do not match.",
  "weak-password": "Password must be at least 8 characters.",
  "setup-failed": "Could not set the password. Please try again."
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

export const GENERIC_LOGIN_ERROR = "Could not sign in. Please try again.";

/**
 * A validation failure with a fixed code. `detail` (e.g. the field label) is
 * kept for server-side debugging only and never goes into the redirect.
 */
export class FormError extends Error {
  readonly code: FormErrorCode;

  constructor(code: FormErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FormError";
    this.code = code;
  }
}

export function formErrorCode(error: unknown): FormErrorCode {
  return error instanceof FormError ? error.code : "unexpected";
}

/**
 * Translates a `?error=` value into a fixed message. Unknown values (including
 * crafted text, arrays from repeated parameters and prototype keys) get the
 * fallback; the input is never returned.
 */
export function errorMessageForCode(
  messages: Readonly<Record<string, string>>,
  code: unknown,
  fallback: string
): string | null {
  if (code === undefined || code === null || code === "") {
    return null;
  }

  if (typeof code === "string" && Object.hasOwn(messages, code)) {
    return messages[code];
  }

  return fallback;
}

export function formErrorMessage(code: unknown): string | null {
  return errorMessageForCode(FORM_ERROR_MESSAGES, code, GENERIC_FORM_ERROR);
}

export function loginErrorMessage(code: unknown): string | null {
  return errorMessageForCode(LOGIN_ERROR_MESSAGES, code, GENERIC_LOGIN_ERROR);
}

// Reconciliation choices on the dashboard (`?reconciliation=`), same rules as above.
export const RECONCILIATION_ERROR_MESSAGES = {
  "not-found": "That pair is no longer available.",
  "pair-changed": "That pair no longer matches.",
  "already-paired": "One side is already paired."
} as const;

export type ReconciliationErrorCode = keyof typeof RECONCILIATION_ERROR_MESSAGES | "unexpected";

export const GENERIC_RECONCILIATION_ERROR = "Could not save that choice. Try again.";

export class ReconciliationError extends Error {
  readonly code: ReconciliationErrorCode;

  constructor(code: ReconciliationErrorCode) {
    super(code);
    this.name = "ReconciliationError";
    this.code = code;
  }
}

export function reconciliationErrorCode(error: unknown): ReconciliationErrorCode {
  return error instanceof ReconciliationError ? error.code : "unexpected";
}

export function reconciliationErrorMessage(code: unknown): string | null {
  return errorMessageForCode(RECONCILIATION_ERROR_MESSAGES, code, GENERIC_RECONCILIATION_ERROR);
}
