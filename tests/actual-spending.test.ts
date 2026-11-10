import { describe, expect, it } from "vitest";
import { calculateActualMonth } from "@/src/finance/actual-spending";
const bank = (id: number, values = {}) => ({ id, txnDate: "2026-11-05T12:00:00Z", description: "Café Example", currencyCode: "UYU", amountMinor: 10000, kind: "purchase" as const, status: "pending" as const, ...values });
const shared = (id: number, values = {}) => ({ id, date: "2026-11-05T09:00:00Z", description: "café example", currency: "UYU", total: "100.00", paid: "100.00", owed: "40.00", payment: false, deleted: false, ...values });
const compute = (b: ReturnType<typeof bank>[], s: ReturnType<typeof shared>[]) => calculateActualMonth("2026-11", b, s);
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
    const result = calculateActualMonth("2026-11", [bank(1)], [shared(2)], [{ bankId: 1, splitwiseId: 2 }]);
    expect(result).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 1 });
  });
  it("responds to changed shared amounts without retaining a stale match", () => expect(compute([bank(1)], [shared(1, { paid: "90.00" })])).toMatchObject({ totals: [{ currency: "UYU", amountMinor: 10000 }], matched: 0, ambiguous: 1 }));
});
