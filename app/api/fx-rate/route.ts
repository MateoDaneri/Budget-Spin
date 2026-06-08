import { NextResponse } from "next/server";
import { listCurrencies } from "@/src/db/repository";
import { fetchLatestFxRate } from "@/src/finance/fx-rate";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base")?.toUpperCase();
  const quote = searchParams.get("quote")?.toUpperCase();

  if (!base || !quote) {
    return NextResponse.json({ error: "base and quote are required." }, { status: 400 });
  }

  const currencyCodes = new Set(listCurrencies().map((currency) => currency.code));

  if (!currencyCodes.has(base) || !currencyCodes.has(quote)) {
    return NextResponse.json({ error: "Unsupported configured currency pair." }, { status: 400 });
  }

  if (base === quote) {
    return NextResponse.json({ base, quote, rate: 1, date: new Date().toISOString().slice(0, 10), source: "local" });
  }

  try {
    const rate = await fetchLatestFxRate(base, quote);
    return NextResponse.json(rate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch FX rate.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
