import type { Currency } from "@/src/db/repository";

export function parseMoneyToMinor(value: string, minorUnit: number) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a positive decimal number.");
  }

  const [whole, rawFraction = ""] = normalized.split(".");
  const fraction = rawFraction.padEnd(minorUnit, "0").slice(0, minorUnit);
  const multiplier = 10 ** minorUnit;

  return Number(whole) * multiplier + Number(fraction || 0);
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
