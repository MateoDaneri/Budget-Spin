import { describe, expect, it } from "vitest";
import type { Currency } from "@/src/db/repository";
import { formatDisplayMoney, formatDisplayMoneyFromBase, formatDisplayMoneyFromUyu } from "@/src/finance/display-money";
import { parseFrankfurterRate } from "@/src/finance/fx-rate";
import { parseMoneyToMinor, toBaseMinor } from "@/src/finance/money";

const uyu: Currency = {
  code: "UYU",
  name: "Uruguayan Peso",
  symbol: "$U",
  minorUnit: 2,
  isBase: true
};

const usd: Currency = {
  code: "USD",
  name: "US Dollar",
  symbol: "US$",
  minorUnit: 2,
  isBase: false
};

const ars: Currency = {
  code: "ARS",
  name: "Argentine Peso",
  symbol: "AR$",
  minorUnit: 2,
  isBase: false
};

describe("money conversion", () => {
  it("parses decimal amounts into minor units", () => {
    expect(parseMoneyToMinor("123.45", 2)).toBe(12345);
  });

  it("keeps base currency amounts unchanged", () => {
    expect(toBaseMinor({ amountMinor: 10000, currency: uyu, baseCurrency: uyu, fxRateToBase: null })).toBe(10000);
  });

  it("uses manual FX rate for foreign currency", () => {
    expect(toBaseMinor({ amountMinor: 10000, currency: usd, baseCurrency: uyu, fxRateToBase: 40 })).toBe(400000);
  });

  it("rejects foreign currency without an FX rate", () => {
    expect(() => toBaseMinor({ amountMinor: 10000, currency: usd, baseCurrency: uyu, fxRateToBase: null })).toThrow(
      "Missing FX rate"
    );
  });
});

describe("display money", () => {
  it("starts base-normalized amounts in UYU and keeps USD as a cycle option", () => {
    expect(formatDisplayMoneyFromUyu({ amountMinor: 4000000, context: { currencies: [uyu, usd], usdToUyuRate: 40 } })).toEqual([
      { currencyCode: "UYU", value: "UYU 40,000.00" },
      { currencyCode: "USD", value: "$1,000.00" }
    ]);
  });

  it("starts item amounts in their original currency before conversion options", () => {
    expect(
      formatDisplayMoney({
        amountMinor: 1000000,
        currencyCode: "ARS",
        fxRateToBase: 0.04,
        context: { currencies: [uyu, usd, ars], usdToUyuRate: 40 }
      })
    ).toEqual([
      { currencyCode: "ARS", value: "ARS 10,000.00" },
      { currencyCode: "USD", value: "$10.00" },
      { currencyCode: "UYU", value: "UYU 400.00" }
    ]);
  });

  it("can start base-normalized plan totals in the plan currency", () => {
    expect(
      formatDisplayMoneyFromBase({
        amountMinor: 8020000,
        baseCurrency: uyu,
        preferredCurrencyCode: "USD",
        preferredFxRateToBase: 40.1,
        context: { currencies: [uyu, usd], usdToUyuRate: 40 }
      })
    ).toEqual([
      { currencyCode: "USD", value: "$2,000.00" },
      { currencyCode: "UYU", value: "UYU 80,200.00" }
    ]);
  });

  it("can start plan item amounts in the parent plan currency", () => {
    expect(
      formatDisplayMoney({
        amountMinor: 8020000,
        currencyCode: "UYU",
        fxRateToBase: null,
        preferredCurrencyCode: "USD",
        preferredFxRateToBase: 40.1,
        context: { currencies: [uyu, usd], usdToUyuRate: 40 }
      })
    ).toEqual([
      { currencyCode: "USD", value: "$2,000.00" },
      { currencyCode: "UYU", value: "UYU 80,200.00" }
    ]);
  });
});

describe("FX provider parsing", () => {
  it("extracts the requested Frankfurter pair", () => {
    expect(
      parseFrankfurterRate({ date: "2026-05-29", base: "USD", quote: "UYU", rate: 40.1234 }, "USD", "UYU")
    ).toEqual({ date: "2026-05-29", base: "USD", quote: "UYU", rate: 40.1234 });
  });

  it("rejects missing Frankfurter pairs", () => {
    expect(() => parseFrankfurterRate({ date: "2026-05-29", base: "USD", quote: "EUR", rate: 0.9 }, "USD", "UYU")).toThrow(
      "unavailable"
    );
  });
});
