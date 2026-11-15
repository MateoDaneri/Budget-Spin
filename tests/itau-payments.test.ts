import { describe, expect, it } from "vitest";
import { isItauBillPayment, isItauCardPayment, parseItauBillPayment } from "@/src/ingest/itau-payments";
import { recurringMatchKey } from "@/src/finance/recurring-match";
import { suggestedPayment, type BillRow } from "@/src/finance/bills";

// Synthetic copy of the observed layout ("Pago realizado" from Itaú Pagos).
const payment = (amount: string) => ({
  subject: "Pago realizado",
  from: "notificaciones@itau.com.uy",
  date: new Date("2026-11-01T02:28:24Z"),
  messageId: "<pay@example.test>",
  html: `Itaú comunica<br>PAGO REALIZADO.<br>Tu pago fue realizado con éxito. Siguen los detalles del mismo:<br>Cuenta origen terminada en ...0000.<br>Monto: ${amount}.<br>Pago a RED EJEMPLO.<br>Si no fuiste tu comunícate al 1784.`
});

describe("Itaú Pagos notices", () => {
  it("reads amount, currency and the collection network, never the source account", () => {
    expect(parseItauBillPayment(payment("$ 13.00"))).toMatchObject({ amountRaw: "13.00", currencyCode: "UYU", merchant: "RED EJEMPLO", txnDateIso: "2026-11-01T02:28:24.000Z" });
    expect(parseItauBillPayment(payment("USD 21.37"))).toMatchObject({ amountRaw: "21.37", currencyCode: "USD" });
    expect(JSON.stringify(parseItauBillPayment(payment("$ 13.00")))).not.toContain("0000");
  });

  it("rejects other senders, subjects and unreadable amounts", () => {
    expect(parseItauBillPayment({ ...payment("$ 13.00"), from: "x@itau.com.uy.example" })).toBeNull();
    expect(parseItauBillPayment({ ...payment("$ 13.00"), subject: "Pago" })).toBeNull();
    expect(parseItauBillPayment(payment("EUR 5.00"))).toBeNull();
    expect(isItauBillPayment({ from: "a@itau.com.uy", subject: "Pago realizado" })).toBe(true);
  });

  it("recognises the card statement payment notice by subject only", () => {
    expect(isItauCardPayment({ from: "a@itau.com.uy", subject: "Aviso de pago de tarjeta de credito" })).toBe(true);
    expect(isItauCardPayment({ from: "a@itau.com.uy", subject: "Aviso de pago de tarjeta de crédito" })).toBe(true);
    expect(isItauCardPayment({ from: "a@evil.example", subject: "Aviso de pago de tarjeta de credito" })).toBe(false);
  });

  it("keys Itaú Pagos payments by network, currency and amount", () => {
    const base = { kind: "purchase" as const, description: "RED EJEMPLO", currencyCode: "UYU", isBillPayment: true };
    expect(recurringMatchKey({ ...base, amountMinor: 320000 })).toBe("payment:red ejemplo:UYU:320000");
    expect(recurringMatchKey({ ...base, amountMinor: 780000 })).toBe("payment:red ejemplo:UYU:780000");
  });

  it("suggests a payment for an unpaid bill with the same currency and amount in the month", () => {
    const row: BillRow = { id: 1, name: "Health", amountMinor: 320000, currencyCode: "UYU", dueDay: null, isActive: true, createdAt: "2026-10-01T00:00:00Z", paidAt: null };
    const payments = [
      { date: "2026-11-05T10:00:00Z", currencyCode: "USD", amountMinor: 320000 },
      { date: "2026-10-05T10:00:00Z", currencyCode: "UYU", amountMinor: 320000 },
      { date: "2026-11-09T10:00:00Z", currencyCode: "UYU", amountMinor: 320000 }
    ];
    expect(suggestedPayment(row, "2026-11", payments)).toEqual(payments[2]);
    expect(suggestedPayment({ ...row, paidAt: "2026-11-09T00:00:00Z" }, "2026-11", payments)).toBeNull();
    expect(suggestedPayment({ ...row, amountMinor: null, currencyCode: null }, "2026-11", payments)).toBeNull();
  });
});
