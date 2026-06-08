import type { Currency } from "@/src/db/repository";
import { fetchLatestFxRate } from "./fx-rate";
import { formatMoney, toBaseMinor } from "./money";

export type DisplayMoneyValue = {
  currencyCode: string;
  value: string;
};

export type DisplayMoneyContext = {
  currencies: Currency[];
  usdToUyuRate: number | null;
};

export async function getDisplayMoneyContext(currencies: Currency[]): Promise<DisplayMoneyContext> {
  let usdToUyuRate: number | null = null;

  try {
    usdToUyuRate = (await fetchLatestFxRate("USD", "UYU")).rate;
  } catch {
    usdToUyuRate = null;
  }

  return { currencies, usdToUyuRate };
}

export function formatDisplayMoney(input: {
  amountMinor: number;
  currencyCode: string;
  fxRateToBase: number | null;
  preferredCurrencyCode?: string;
  preferredFxRateToBase?: number | null;
  context: DisplayMoneyContext;
}) {
  const currencyByCode = new Map(input.context.currencies.map((currency) => [currency.code, currency]));
  const sourceCurrency = requireCurrency(currencyByCode, input.currencyCode);
  const usd = requireCurrency(currencyByCode, "USD");
  const uyu = requireCurrency(currencyByCode, "UYU");
  const output: DisplayMoneyValue[] = [];
  const preferredCurrency = input.preferredCurrencyCode ? requireCurrency(currencyByCode, input.preferredCurrencyCode) : null;

  if (preferredCurrency) {
    addDisplayValue(
      output,
      preferredCurrency.code,
      formatMaybeMoney(convertToPreferredMinor(input, sourceCurrency, preferredCurrency, uyu), preferredCurrency)
    );
  }
  addDisplayValue(output, sourceCurrency.code, formatMoney(input.amountMinor, sourceCurrency));
  addDisplayValue(output, usd.code, formatMaybeMoney(convertToUsdMinor(input, sourceCurrency, usd, uyu), usd));
  addDisplayValue(output, uyu.code, formatMoney(convertToUyuMinor(input, sourceCurrency, uyu), uyu));

  return output;
}

export function formatDisplayMoneyFromUyu(input: { amountMinor: number; context: DisplayMoneyContext }) {
  const currencyByCode = new Map(input.context.currencies.map((currency) => [currency.code, currency]));
  const usd = requireCurrency(currencyByCode, "USD");
  const uyu = requireCurrency(currencyByCode, "UYU");

  return [
    { currencyCode: uyu.code, value: formatMoney(input.amountMinor, uyu) },
    {
      currencyCode: usd.code,
      value: formatMaybeMoney(convertUyuToUsdMinor(input.amountMinor, uyu, usd, input.context.usdToUyuRate), usd)
    }
  ];
}

export function formatDisplayMoneyFromBase(input: {
  amountMinor: number;
  baseCurrency: Currency;
  preferredCurrencyCode?: string;
  preferredFxRateToBase?: number | null;
  context: DisplayMoneyContext;
}) {
  const currencyByCode = new Map(input.context.currencies.map((currency) => [currency.code, currency]));
  const usd = requireCurrency(currencyByCode, "USD");
  const uyu = requireCurrency(currencyByCode, "UYU");
  const output: DisplayMoneyValue[] = [];
  const preferredCurrency = input.preferredCurrencyCode ? requireCurrency(currencyByCode, input.preferredCurrencyCode) : null;

  if (preferredCurrency) {
    addDisplayValue(
      output,
      preferredCurrency.code,
      formatMaybeMoney(
        convertBaseToPreferredMinor(input.amountMinor, input.baseCurrency, preferredCurrency, input.preferredFxRateToBase),
        preferredCurrency
      )
    );
  }

  addDisplayValue(output, input.baseCurrency.code, formatMoney(input.amountMinor, input.baseCurrency));

  if (input.baseCurrency.code === "UYU") {
    addDisplayValue(output, usd.code, formatMaybeMoney(convertUyuToUsdMinor(input.amountMinor, uyu, usd, input.context.usdToUyuRate), usd));
    addDisplayValue(output, uyu.code, formatMoney(input.amountMinor, uyu));
  } else if (input.baseCurrency.code === "USD") {
    addDisplayValue(output, usd.code, formatMoney(input.amountMinor, usd));
    addDisplayValue(output, uyu.code, formatMaybeMoney(convertUsdToUyuMinor(input.amountMinor, usd, uyu, input.context.usdToUyuRate), uyu));
  }

  return output;
}

function convertToUyuMinor(
  input: {
    amountMinor: number;
    currencyCode: string;
    fxRateToBase: number | null;
  },
  sourceCurrency: Currency,
  uyu: Currency
) {
  if (sourceCurrency.code === "UYU") {
    return input.amountMinor;
  }

  return toBaseMinor({
    amountMinor: input.amountMinor,
    currency: sourceCurrency,
    baseCurrency: uyu,
    fxRateToBase: input.fxRateToBase
  });
}

function convertToPreferredMinor(
  input: {
    amountMinor: number;
    currencyCode: string;
    fxRateToBase: number | null;
    preferredFxRateToBase?: number | null;
    context: DisplayMoneyContext;
  },
  sourceCurrency: Currency,
  preferredCurrency: Currency,
  uyu: Currency
) {
  if (sourceCurrency.code === preferredCurrency.code) {
    return input.amountMinor;
  }

  const uyuMinor = convertToUyuMinor(input, sourceCurrency, uyu);
  return convertUyuToCurrencyMinor(
    uyuMinor,
    uyu,
    preferredCurrency,
    input.preferredFxRateToBase ?? (preferredCurrency.code === "USD" ? input.context.usdToUyuRate : null)
  );
}

function convertToUsdMinor(
  input: {
    amountMinor: number;
    currencyCode: string;
    fxRateToBase: number | null;
    context: DisplayMoneyContext;
  },
  sourceCurrency: Currency,
  usd: Currency,
  uyu: Currency
): number | null {
  if (sourceCurrency.code === "USD") {
    return input.amountMinor;
  }

  const uyuMinor = convertToUyuMinor(input, sourceCurrency, uyu);
  return convertUyuToUsdMinor(uyuMinor, uyu, usd, input.context.usdToUyuRate);
}

function convertBaseToPreferredMinor(
  amountMinor: number,
  baseCurrency: Currency,
  preferredCurrency: Currency,
  preferredFxRateToBase: number | null | undefined
) {
  if (baseCurrency.code === preferredCurrency.code) {
    return amountMinor;
  }

  if (!preferredFxRateToBase || preferredFxRateToBase <= 0) {
    return null;
  }

  const baseMajor = amountMinor / 10 ** baseCurrency.minorUnit;
  const preferredMajor = baseMajor / preferredFxRateToBase;
  return Math.round(preferredMajor * 10 ** preferredCurrency.minorUnit);
}

function convertUyuToUsdMinor(uyuMinor: number, uyu: Currency, usd: Currency, usdToUyuRate: number | null) {
  if (!usdToUyuRate || usdToUyuRate <= 0) {
    return null;
  }

  const uyuMajor = uyuMinor / 10 ** uyu.minorUnit;
  const usdMajor = uyuMajor / usdToUyuRate;
  return Math.round(usdMajor * 10 ** usd.minorUnit);
}

function convertUyuToCurrencyMinor(uyuMinor: number, uyu: Currency, target: Currency, fxRateToBase: number | null) {
  if (target.code === "UYU") {
    return uyuMinor;
  }

  if (!fxRateToBase || fxRateToBase <= 0) {
    return null;
  }

  const uyuMajor = uyuMinor / 10 ** uyu.minorUnit;
  const targetMajor = uyuMajor / fxRateToBase;
  return Math.round(targetMajor * 10 ** target.minorUnit);
}

function convertUsdToUyuMinor(usdMinor: number, usd: Currency, uyu: Currency, usdToUyuRate: number | null) {
  if (!usdToUyuRate || usdToUyuRate <= 0) {
    return null;
  }

  const usdMajor = usdMinor / 10 ** usd.minorUnit;
  const uyuMajor = usdMajor * usdToUyuRate;
  return Math.round(uyuMajor * 10 ** uyu.minorUnit);
}

function formatMaybeMoney(amountMinor: number | null, currency: Currency) {
  if (amountMinor === null) {
    return `${currency.code} unavailable`;
  }

  return formatMoney(amountMinor, currency);
}

function addDisplayValue(output: DisplayMoneyValue[], currencyCode: string, value: string) {
  if (output.some((item) => item.currencyCode === currencyCode)) {
    return;
  }

  output.push({ currencyCode, value });
}

function requireCurrency(currencies: Map<string, Currency>, code: string) {
  const currency = currencies.get(code);
  if (!currency) {
    throw new Error(`Currency ${code} must be configured.`);
  }

  return currency;
}
