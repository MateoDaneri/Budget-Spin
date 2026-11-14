import { describe, expect, it } from "vitest";
import { calculateActualMonth, type ActualMonth } from "@/src/finance/actual-spending";
/** Invariant: totals are exactly the per-currency sum of the dated contributions. */
function checked(result: ActualMonth): ActualMonth {
  const sums = new Map<string, number>();
  for (const item of result.contributions) sums.set(item.currency, (sums.get(item.currency) ?? 0) + item.amountMinor);
  expect(result.totals).toEqual([...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor })));
  return result;
}
const bank = (id: number, values = {}) => ({ id, txnDate: "2026-11-05T12:00:00Z", description: "Café Example", currencyCode: "UYU", amountMinor: 10000, kind: "purchase" as const, status: "pending" as const, ...values });
const shared = (id: number, values = {}) => ({ id, date: "2026-11-05T09:00:00Z", description: "café example", currency: "UYU", total: "100.00", paid: "100.00", owed: "40.00", payment: false, deleted: false, ...values });
const units = new Map([["UYU", 2], ["USD", 2]]);
const compute = (b: ReturnType<typeof bank>[], s: ReturnType<typeof shared>[], minorUnits: ReadonlyMap<string, number> = units) => checked(calculateActualMonth("2026-11", b, s, minorUnits));
describe("actual spending reconciliation", () => {
  it("uses personal share for a unique exact match", () => expect(compute([bank(1)], [shared(2)])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 4000 }], matched: 1, pending: 1 }));
  it("does not silently pair repeated purchases or installments", () => expect(compute([bank(1), bank(2)], [shared(1)])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 20000 }], matched: 0, ambiguous: 1 }));
  it("does not pair repeated shared rows with one bank notice", () => expect(compute([bank(1)], [shared(1), shared(2)])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], ambiguous: 2 }));
  it("adds another payer's own share, excludes payments/deletions and keeps currencies separate", () => expect(compute([bank(1)], [shared(1, { paid: "0.00", currency: "USD" }), shared(2, { payment: true }), shared(3, { deleted: true })])).toMatchObject({ totals: [{ currency: "USD", amountMinor: 4000 }, { currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 0 }));
  it("ignores transfers and discarded notices; refuses refunds and unknown precision", () => expect(compute([bank(1, { kind: "transfer_out" }), bank(2, { status: "discarded" })], [shared(1, { paid: "-3.00" }), shared(2, { currency: "JPY" })])).toMatchObject({ totals: [], omitted: 2 }));
  it("does not add an unpaid shared share when a same-day merchant notice could overlap", () => {
    expect(compute([bank(1)], [shared(2, { paid: "0.00" })])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], ambiguous: 1 });
  });
  it("allows a user to reject an otherwise unique pair", () => {
    const result = checked(calculateActualMonth("2026-11", [bank(1)], [shared(2)], units, [{ bankId: 1, splitwiseId: 2 }]));
    expect(result).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 1 });
  });
  it("converts a 2-decimal currency with its configured minor unit", () => expect(compute([], [shared(1, { paid: "0.00", owed: "12.34", total: "50.5" })])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 1234 }], omitted: 0 }));
  it("converts a 0-decimal currency on the same scale as its bank amounts", () => {
    const yen = new Map([["JPY", 0]]);
    const result = compute([bank(1, { currencyCode: "JPY", amountMinor: 1500, description: "Other shop" })], [shared(2, { currency: "JPY", paid: "0", owed: "600", total: "1500.00" })], yen);
    expect(result).toMatchObject({ totals: [{ currency: "JPY", amountMinor: 2100 }], omitted: 0 });
  });
  it("matches a 0-decimal bank notice using the configured minor unit", () => {
    const yen = new Map([["JPY", 0]]);
    const result = compute([bank(1, { currencyCode: "JPY", amountMinor: 1500 })], [shared(2, { currency: "JPY", paid: "1500", owed: "600", total: "1500" })], yen);
    expect(result).toMatchObject({ totals: [{ currency: "JPY", amountMinor: 600 }], matched: 1 });
  });
  it("omits amounts with more decimals than the currency allows instead of rounding", () => {
    expect(compute([], [shared(1, { currency: "JPY", paid: "0", owed: "600.5", total: "1500" })], new Map([["JPY", 0]]))).toMatchObject({ totals: [], omitted: 1 });
    expect(compute([], [shared(1, { paid: "0.00", owed: "12.345", total: "50.00" })])).toMatchObject({ totals: [], omitted: 1 });
  });
  it("responds to changed shared amounts without retaining a stale match", () => expect(compute([bank(1)], [shared(1, { paid: "90.00" })])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 1 }));
});

describe("dated contributions", () => {
  it("records an unpaired purchase at its bank date", () => {
    expect(compute([bank(7, { description: "Other shop" })], []).contributions).toEqual([{ date: "2026-11-05", currency: "UYU", amountMinor: 10000, source: "bank", refId: 7 }]);
  });
  it("records an automatic pair as the own share at the bank date", () => {
    expect(compute([bank(1)], [shared(2)]).contributions).toEqual([{ date: "2026-11-05", currency: "UYU", amountMinor: 4000, source: "bank", refId: 1 }]);
  });
  it("records a manual pair at the bank date even when Splitwise is a day later", () => {
    const result = checked(calculateActualMonth("2026-11", [bank(1, { txnDate: "2026-11-05T23:30:00Z" })], [shared(2, { date: "2026-11-06T10:00:00Z", description: "other" })], units, [], [{ bankId: 1, splitwiseId: 2 }]));
    expect(result.contributions).toEqual([{ date: "2026-11-05", currency: "UYU", amountMinor: 4000, source: "bank", refId: 1 }]);
  });
  it("records an unpaid Splitwise share at the Splitwise date", () => {
    expect(compute([], [shared(9, { paid: "0.00", date: "2026-11-20T15:00:00Z" })]).contributions).toEqual([{ date: "2026-11-20", currency: "UYU", amountMinor: 4000, source: "splitwise", refId: 9 }]);
  });
  it("records a stale confirmation as the full bank amount", () => {
    const result = checked(calculateActualMonth("2026-11", [bank(1)], [shared(2, { paid: "90.00" })], units, [], [{ bankId: 1, splitwiseId: 2 }]));
    expect(result.contributions).toEqual([{ date: "2026-11-05", currency: "UYU", amountMinor: 10000, source: "bank", refId: 1 }]);
    expect(result.omitted).toBe(1);
  });
});
