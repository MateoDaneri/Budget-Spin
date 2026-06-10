"use client";

import { useEffect, useMemo, useState } from "react";
import type { Currency } from "@/src/db/repository";

type Props = {
  baseCurrencyCode: string;
  currencies: Currency[];
  currencyInputId: string;
  defaultCurrencyCode?: string;
  defaultFxRate?: number | string | null;
  fxInputId: string;
};

type FetchState = "idle" | "loading" | "loaded" | "error";

export function CurrencyFxFields({
  baseCurrencyCode,
  currencies,
  currencyInputId,
  defaultCurrencyCode,
  defaultFxRate,
  fxInputId
}: Props) {
  const initialCurrencyCode = defaultCurrencyCode ?? baseCurrencyCode;
  const [currencyCode, setCurrencyCode] = useState(initialCurrencyCode);
  const [fxRate, setFxRate] = useState(defaultFxRate?.toString() ?? "");
  const [state, setState] = useState<FetchState>("idle");
  const [message, setMessage] = useState("");
  const needsFx = currencyCode !== baseCurrencyCode;
  const fxHelpId = `${fxInputId}-help`;

  const currencyOptions = useMemo(
    () =>
      currencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code}
        </option>
      )),
    [currencies]
  );

  useEffect(() => {
    if (!needsFx) {
      return;
    }

    const controller = new AbortController();

    async function fetchRate() {
      setState("loading");
      setMessage(`Fetching ${currencyCode} to ${baseCurrencyCode}...`);

      try {
        const params = new URLSearchParams({ base: currencyCode, quote: baseCurrencyCode });
        const response = await fetch(`/api/fx-rate?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as { rate?: number; date?: string; error?: string };

        if (!response.ok || typeof payload.rate !== "number") {
          throw new Error(payload.error ?? "Could not fetch FX rate.");
        }

        setFxRate(String(payload.rate));
        setState("loaded");
        setMessage(`Latest ${currencyCode} to ${baseCurrencyCode}: ${payload.rate} (${payload.date}).`);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setState("error");
        setMessage(error instanceof Error ? error.message : "Could not fetch FX rate.");
      }
    }

    fetchRate();

    return () => controller.abort();
  }, [baseCurrencyCode, currencyCode, needsFx]);

  return (
    <>
      <div className="field">
        <label htmlFor={currencyInputId}>Currency</label>
        <select
          id={currencyInputId}
          name="currencyCode"
          onChange={(event) => {
            const nextCode = event.target.value;
            setCurrencyCode(nextCode);
            if (nextCode === baseCurrencyCode) {
              setFxRate("");
              setState("idle");
              setMessage("");
            }
          }}
          required
          value={currencyCode}
        >
          {currencyOptions}
        </select>
      </div>
      <div className="field">
        <label htmlFor={fxInputId}>FX to base</label>
        <input
          aria-describedby={fxHelpId}
          disabled={!needsFx}
          id={fxInputId}
          inputMode="decimal"
          min="0"
          name="fxRateToBase"
          onChange={(event) => setFxRate(event.target.value)}
          placeholder={needsFx ? `auto ${currencyCode} to ${baseCurrencyCode}` : "base currency"}
          required={needsFx}
          step="any"
          type="number"
          value={fxRate}
        />
        <span className={`field-help ${state === "error" ? "field-help-error" : ""}`} id={fxHelpId}>
          {needsFx ? message || `Required for non-${baseCurrencyCode} amounts.` : "Base currency: no FX rate needed."}
        </span>
      </div>
    </>
  );
}
