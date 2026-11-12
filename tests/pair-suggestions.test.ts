import { describe, expect, it } from "vitest";
import { calculateActualMonth, suggestPairs, type PairRef } from "@/src/finance/actual-spending";

// Synthetic records only. Bank 1 and Splitwise 2 are a near match: the bank's UTC date is the day
// before Splitwise's and the descriptions differ, so the exact rule does not pair them.
const bank = (id: number, values = {}) => ({ id, txnDate: "2026-11-05T23:30:00Z", description: "COMERCIO PRUEBA 01", currencyCode: "UYU", amountMinor: 10000, kind: "purchase" as const, status: "confirmed" as const, ...values });
const shared = (id: number, values = {}) => ({ id, date: "2026-11-06T01:00:00Z", description: "Cena de prueba", currency: "UYU", total: "100.00", paid: "100.00", owed: "40.00", payment: false, deleted: false, ...values });
const units = new Map([["UYU", 2], ["USD", 2]]);
type B = ReturnType<typeof bank>;
type S = ReturnType<typeof shared>;
const suggest = (b: B[], s: S[], exclusions: PairRef[] = [], confirmations: PairRef[] = []) => suggestPairs("2026-11", b, s, units, exclusions, confirmations);
const compute = (b: B[], s: S[], exclusions: PairRef[] = [], confirmations: PairRef[] = []) => calculateActualMonth("2026-11", b, s, units, exclusions, confirmations);

describe("near-match suggestions", () => {
  it("suggests a unique pair one day apart in either direction", () => {
    expect(suggest([bank(1)], [shared(2)])).toEqual([{ bankId: 1, splitwiseId: 2, bankDescription: "COMERCIO PRUEBA 01", splitwiseDescription: "Cena de prueba", bankDate: "2026-11-05", splitwiseDate: "2026-11-06", currency: "UYU", paidMinor: 10000, owedMinor: 4000 }]);
    expect(suggest([bank(1, { txnDate: "2026-11-07T00:10:00Z" })], [shared(2)])).toMatchObject([{ bankId: 1, splitwiseId: 2 }]);
  });
  it("does not suggest two days apart", () => expect(suggest([bank(1)], [shared(2, { date: "2026-11-07T01:00:00Z" })])).toEqual([]));
  it("does not suggest across currencies", () => expect(suggest([bank(1)], [shared(2, { currency: "USD" })])).toEqual([]));
  it("does not suggest when the paid share differs from the bank amount", () => {
    expect(suggest([bank(1)], [shared(2, { paid: "90.00" })])).toEqual([]);
    expect(suggest([bank(1)], [shared(2, { paid: "0.00" })])).toEqual([]);
  });
  it("does not suggest ambiguous one-to-many candidates on either side", () => {
    expect(suggest([bank(1)], [shared(2), shared(3, { date: "2026-11-05T10:00:00Z" })])).toEqual([]);
    expect(suggest([bank(1), bank(4, { txnDate: "2026-11-06T12:00:00Z" })], [shared(2)])).toEqual([]);
  });
  it("does not suggest a rejected pair", () => expect(suggest([bank(1)], [shared(2)], [{ bankId: 1, splitwiseId: 2 }])).toEqual([]));
  it("does not suggest records already paired automatically or by hand", () => {
    // Bank 1 pairs exactly with Splitwise 2; Splitwise 3 is near bank 1 but bank 1 is taken.
    const exact = shared(2, { date: "2026-11-05T09:00:00Z", description: "comercio prueba 01" });
    expect(compute([bank(1)], [exact, shared(3)]).pairs).toMatchObject([{ bankId: 1, splitwiseId: 2, manual: false }]);
    expect(suggest([bank(1)], [exact, shared(3)])).toEqual([]);
    expect(suggest([bank(1)], [shared(2)], [], [{ bankId: 1, splitwiseId: 2 }])).toEqual([]);
    expect(suggest([bank(1), bank(4, { txnDate: "2026-11-20T12:00:00Z" })], [shared(2)], [], [{ bankId: 4, splitwiseId: 2 }])).toEqual([]);
  });
  it("does not suggest a pair whose shares are unusable", () => expect(suggest([bank(1)], [shared(2, { owed: "120.00" })])).toEqual([]));
  it("leaves totals unchanged while a pair is only suggested", () => {
    expect(suggest([bank(1)], [shared(2)])).toHaveLength(1);
    expect(compute([bank(1)], [shared(2)])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 1, pairs: [] });
  });
});

describe("manually confirmed pairs", () => {
  it("applies a confirmed pair like an automatic one", () => {
    expect(compute([bank(1)], [shared(2)], [], [{ bankId: 1, splitwiseId: 2 }])).toMatchObject({
      totals: [{ currency: "UYU", amountMinor: 4000 }], matched: 1, ambiguous: 0, omitted: 0,
      pairs: [{ bankId: 1, splitwiseId: 2, paidMinor: 10000, owedMinor: 4000, manual: true }]
    });
  });
  it("takes priority over the automatic rule", () => {
    const exact = shared(2, { date: "2026-11-05T09:00:00Z", description: "comercio prueba 01" });
    const result = compute([bank(1)], [exact, shared(3, { owed: "30.00" })], [], [{ bankId: 1, splitwiseId: 3 }]);
    // The manual pair wins; the exact candidate (paid > 0) is no longer paired and is left out as ambiguous.
    expect(result).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 3000 }], matched: 1, ambiguous: 1, pairs: [{ bankId: 1, splitwiseId: 3, manual: true }] });
  });
  it("does not apply a confirmed pair whose amounts became invalid and counts it as omitted", () => {
    expect(compute([bank(1)], [shared(2, { paid: "90.00" })], [], [{ bankId: 1, splitwiseId: 2 }])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, omitted: 1, pairs: [] });
    expect(compute([bank(1)], [shared(2, { owed: "120.00" })], [], [{ bankId: 1, splitwiseId: 2 }])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, omitted: 1, pairs: [] });
  });
  it("keeps a stale confirmation out of the automatic rule", () => {
    // Splitwise 2 now matches bank 1 exactly but the confirmation points elsewhere and is invalid.
    const exact = shared(2, { date: "2026-11-05T09:00:00Z", description: "comercio prueba 01" });
    const result = compute([bank(1)], [exact, shared(3, { paid: "50.00" })], [], [{ bankId: 1, splitwiseId: 3 }]);
    expect(result).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, omitted: 1, ambiguous: 1, pairs: [] });
  });
  it("lets a rejection of the same pair win over a confirmation", () => {
    const pair = { bankId: 1, splitwiseId: 2 };
    expect(compute([bank(1)], [shared(2)], [pair], [pair])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0 });
  });
});
