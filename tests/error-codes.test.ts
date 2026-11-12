import { afterEach, describe, expect, it, vi } from "vitest";

// redirect() throws in Next.js; the mock throws this so the action stops there.
const { RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    readonly url: string;

    constructor(url: string) {
      super("redirect");
      this.url = url;
    }
  }
  return { RedirectSignal };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  })
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/db/repository", () => ({
  DefaultExpenseGroupError: class DefaultExpenseGroupError extends Error {},
  listCurrencies: vi.fn(),
  getBaseCurrency: vi.fn(),
  upsertRecurringExpense: vi.fn(),
  upsertCategory: vi.fn()
}));
vi.mock("@/src/auth/session", () => ({
  isPasswordConfigured: vi.fn(),
  setUserPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  verifyCredentials: vi.fn()
}));

import { getBaseCurrency, listCurrencies, upsertCategory, upsertRecurringExpense } from "@/src/db/repository";
import { setUserPassword, isPasswordConfigured, verifyCredentials } from "@/src/auth/session";
import {
  FORM_ERROR_MESSAGES,
  FormError,
  GENERIC_FORM_ERROR,
  GENERIC_LOGIN_ERROR,
  LOGIN_ERROR_MESSAGES,
  formErrorCode,
  formErrorMessage,
  loginErrorMessage
} from "@/src/actions/error-codes";
import { saveCategoryAction, saveExpenseAction } from "@/src/actions/forms";
import { initializePasswordAction, loginAction } from "@/src/actions/auth";

const CRAFTED = "Your session expired. Call +00 000 000 to verify your account.";
const CODE = /^[a-z-]{1,40}$/;

const USD = { code: "USD", name: "Dollar", symbol: "$", minorUnit: 2, isBase: true };

async function redirectedTo(action: Promise<unknown>): Promise<string> {
  const error = await action.then(
    () => {
      throw new Error("expected a redirect");
    },
    (reason: unknown) => reason
  );
  if (!(error instanceof RedirectSignal)) throw error;
  return error.url;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function expenseForm(overrides: Record<string, string> = {}) {
  return form({
    currencyCode: "USD",
    frequency: "monthly",
    categoryId: "1",
    groupId: "1",
    description: "Rent",
    amount: "100",
    startDate: "2026-01-01",
    ...overrides
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("error code mapping", () => {
  it("returns nothing when there is no error", () => {
    expect(formErrorMessage(undefined)).toBeNull();
    expect(formErrorMessage("")).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });

  it("maps known codes to their fixed messages", () => {
    expect(formErrorMessage("invalid-amount")).toBe(FORM_ERROR_MESSAGES["invalid-amount"]);
    expect(loginErrorMessage("invalid-credentials")).toBe(LOGIN_ERROR_MESSAGES["invalid-credentials"]);
  });

  it("never echoes crafted or unknown values", () => {
    for (const value of [CRAFTED, "unexpected", "__proto__", "toString", "constructor", ["invalid-amount", "x"], 42]) {
      expect(formErrorMessage(value)).toBe(GENERIC_FORM_ERROR);
      expect(loginErrorMessage(value)).toBe(GENERIC_LOGIN_ERROR);
    }
  });

  it("only produces short slug codes", () => {
    for (const code of [...Object.keys(FORM_ERROR_MESSAGES), ...Object.keys(LOGIN_ERROR_MESSAGES)]) {
      expect(code).toMatch(CODE);
    }
    expect(formErrorCode(new FormError("missing-field", "Amount"))).toBe("missing-field");
    expect(formErrorCode(new Error("SQLITE_CONSTRAINT: internal detail"))).toBe("unexpected");
    expect(formErrorCode("not an error")).toBe("unexpected");
  });
});

describe("form actions redirect with codes", () => {
  it("uses invalid-amount for a malformed amount", async () => {
    vi.mocked(listCurrencies).mockReturnValue([USD]);
    vi.mocked(getBaseCurrency).mockReturnValue(USD);
    const url = await redirectedTo(saveExpenseAction(expenseForm({ amount: CRAFTED })));
    expect(url).toBe("/expenses?error=invalid-amount");
    expect(upsertRecurringExpense).not.toHaveBeenCalled();
  });

  it("uses missing-field and unknown-currency for validation failures", async () => {
    vi.mocked(listCurrencies).mockReturnValue([USD]);
    vi.mocked(getBaseCurrency).mockReturnValue(USD);
    expect(await redirectedTo(saveExpenseAction(expenseForm({ description: " " })))).toBe("/expenses?error=missing-field");
    expect(await redirectedTo(saveExpenseAction(expenseForm({ currencyCode: "XXX" })))).toBe(
      "/expenses?error=unknown-currency"
    );
  });

  it("does not leak internal exception text", async () => {
    vi.mocked(upsertCategory).mockImplementationOnce(() => {
      throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: categories.name");
    });
    const url = await redirectedTo(saveCategoryAction(form({ name: "Food", type: "expense" })));
    expect(url).toBe("/categories?error=unexpected");
  });
});

describe("login actions redirect with codes", () => {
  it("uses one code for any failed login", async () => {
    vi.mocked(verifyCredentials).mockReturnValue(false);
    const url = await redirectedTo(loginAction(form({ username: "nobody", password: "wrong-password" })));
    expect(url).toBe("/login?error=invalid-credentials");
    expect(await redirectedTo(loginAction(form({ username: "", password: "x" })))).toBe("/login?error=missing-field");
  });

  it("uses fixed codes when setting the first password", async () => {
    vi.mocked(isPasswordConfigured).mockReturnValue(false);
    expect(await redirectedTo(initializePasswordAction(form({ password: "abcdefgh", confirmPassword: "abcdefgX" })))).toBe(
      "/login?error=password-mismatch"
    );
    expect(await redirectedTo(initializePasswordAction(form({ password: "short", confirmPassword: "short" })))).toBe(
      "/login?error=weak-password"
    );
    vi.mocked(setUserPassword).mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    expect(await redirectedTo(initializePasswordAction(form({ password: "abcdefgh", confirmPassword: "abcdefgh" })))).toBe(
      "/login?error=setup-failed"
    );
  });
});
