export type LatestFxRate = {
  base: string;
  quote: string;
  rate: number;
  date: string;
  source: "frankfurter";
};

type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

export async function fetchLatestFxRate(base: string, quote: string): Promise<LatestFxRate> {
  const url = new URL(`https://api.frankfurter.dev/v2/rate/${base}/${quote}`);

  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    },
    next: {
      revalidate: 60 * 60 * 6
    }
  });

  if (!response.ok) {
    throw new Error(`FX provider returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const rate = parseFrankfurterRate(payload, base, quote);

  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    throw new Error(`Invalid FX rate for ${base} to ${quote}.`);
  }

  return {
    base: rate.base,
    quote: rate.quote,
    rate: rate.rate,
    date: rate.date,
    source: "frankfurter"
  };
}

export function parseFrankfurterRate(payload: unknown, base: string, quote: string): FrankfurterRate {
  if (!payload || typeof payload !== "object") {
    throw new Error("Unexpected FX provider response.");
  }

  const candidate = payload as Partial<FrankfurterRate>;

  if (candidate.base !== base || candidate.quote !== quote || typeof candidate.rate !== "number") {
    throw new Error(`FX rate for ${base} to ${quote} is unavailable.`);
  }

  if (typeof candidate.date !== "string") {
    throw new Error("Unexpected FX provider response.");
  }

  return {
    date: candidate.date,
    base: candidate.base,
    quote: candidate.quote,
    rate: candidate.rate
  };
}
