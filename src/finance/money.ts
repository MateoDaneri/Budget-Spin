import type { Currency } from "@/src/db/repository";

export function parseMoneyToMinor(value: string, minorUnit: number) {
  const normalized = value.trim().replace(",", ".");
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: no nested quantifiers or ambiguous alternation, backtracking is linear
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a positive decimal number.");
  }

  const [whole, rawFraction = ""] = normalized.split(".");
  const fraction = rawFraction.padEnd(minorUnit, "0").slice(0, minorUnit);
  const multiplier = 10 ** minorUnit;

  return Number(whole) * multiplier + Number(fraction || 0);
}

/**
 * Signed decimal → integer minor units, for balances and adjustments. Accepts one leading "-" and a
 * "," or "." decimal separator. Any digit beyond the currency's minor unit is rejected, never truncated:
 * "1.000" (one thousand, written with a thousands separator) must not become 1.00.
 */
export function parseSignedMoneyToMinor(value: string, minorUnit: number): number {
  const normalized = value.trim().replace(",", ".");
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded digit groups separated by a literal dot; linear backtracking.
  const match = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) {
    throw new RangeError("Amount must be a decimal number.");
  }
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > minorUnit) {
    throw new RangeError("Amount has more decimals than the currency allows.");
  }
  const magnitude = Number(whole + fraction.padEnd(minorUnit, "0"));
  if (!Number.isSafeInteger(magnitude)) {
    throw new RangeError("Amount is too large.");
  }
  return sign === "-" ? -magnitude : magnitude;
}

export function formatMoney(amountMinor: number, currency: Currency) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: currency.minorUnit,
    maximumFractionDigits: currency.minorUnit
  }).format(amountMinor / 10 ** currency.minorUnit);
}

export function toBaseMinor(input: {
  amountMinor: number;
  currency: Currency;
  baseCurrency: Currency;
  fxRateToBase: number | null;
}) {
  if (input.currency.code === input.baseCurrency.code) {
    return input.amountMinor;
  }

  if (!input.fxRateToBase || input.fxRateToBase <= 0) {
    throw new Error(`Missing FX rate from ${input.currency.code} to ${input.baseCurrency.code}.`);
  }

  const sourceMajor = input.amountMinor / 10 ** input.currency.minorUnit;
  const baseMajor = sourceMajor * input.fxRateToBase;
  return Math.round(baseMajor * 10 ** input.baseCurrency.minorUnit);
}

export function minorToInputValue(amountMinor: number, minorUnit: number) {
  return (amountMinor / 10 ** minorUnit).toFixed(minorUnit);
}
