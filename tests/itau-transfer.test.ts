import { describe, expect, it } from "vitest";
import { isItauTransfer, parseItauTransfer } from "@/src/ingest/itau-transfer";

const notice = { subject: "Aviso transferencia realizada", from: "notificaciones@itau.com.uy", date: new Date("2026-01-01T12:00:00Z"), messageId: "<synthetic@example.test>", html: "<p>Transferencia realizada desde la cuenta ****0000</p><p>Importe: 123.45 URGP</p><p>Cuenta destino: EJEMPLO</p>" };
describe("transfer notices", () => {
  it("extracts a sent transfer without a destination when the notice has none, and never the source account", () => {
    expect(parseItauTransfer(notice)).toMatchObject({ amountRaw: "123.45", currencyCode: "UYU", kind: "transfer_out", merchant: "Transferencia enviada", paymentMethod: null, counterpartyBank: null, counterpartyLast4: null });
    expect(JSON.stringify(parseItauTransfer(notice))).not.toContain("0000");
  });

  // Synthetic copy of the observed layout: Itaú masks the destination account and sends no payee name.
  const withDestination = { ...notice, html: "Itaú comunica<br>AVISO DE TRANSFERENCIA REALIZADA<br>Transferencia realizada desde la cuenta ****0000<br>Importe: 3900.00 UYU<br>Cuenta destino: ******1234<br>Banco/Instituci&oacute;n destino: <b>Banco  Ejemplo</b><br>Además ingresando con tu documento" };

  it("keeps the destination bank and last four digits as Itaú prints them", () => {
    const parsed = parseItauTransfer(withDestination);
    expect(parsed).toMatchObject({ amountRaw: "3900.00", currencyCode: "UYU", counterpartyBank: "Banco Ejemplo", counterpartyLast4: "1234", rawExcerpt: "3900.00 UYU · Transferencia enviada · Banco Ejemplo ***1234" });
    expect(JSON.stringify(parsed)).not.toContain("0000");
  });

  it("keeps only the last four digits when Itaú shows more", () => {
    expect(parseItauTransfer({ ...withDestination, html: withDestination.html.replace("******1234", "***98761234") })).toMatchObject({ counterpartyLast4: "1234" });
  });
  it("rejects unknown currencies and spoofed domains", () => {
    expect(parseItauTransfer({ ...notice, html: notice.html.replace("URGP", "ZZZZ") })).toBeNull();
    expect(isItauTransfer({ ...notice, from: "x@itau.com.uy.example" })).toBe(false);
  });
});
