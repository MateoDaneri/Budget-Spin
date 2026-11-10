import { describe, expect, it } from "vitest";
import { isItauTransfer, parseItauTransfer } from "@/src/ingest/itau-transfer";

const notice = { subject: "Aviso transferencia realizada", from: "notificaciones@itau.com.uy", date: new Date("2026-01-01T12:00:00Z"), messageId: "<synthetic@example.test>", html: "<p>Transferencia realizada desde la cuenta ****0000</p><p>Importe: 123.45 URGP</p><p>Cuenta destino: EJEMPLO</p>" };
describe("transfer notices", () => {
  it("extracts a sent transfer without retaining account identifiers", () => {
    expect(parseItauTransfer(notice)).toMatchObject({ amountRaw: "123.45", currencyCode: "UYU", kind: "transfer_out", merchant: "Transferencia enviada" });
    expect(JSON.stringify(parseItauTransfer(notice))).not.toContain("0000");
    expect(JSON.stringify(parseItauTransfer(notice))).not.toContain("EJEMPLO");
  });
  it("rejects unknown currencies and spoofed domains", () => {
    expect(parseItauTransfer({ ...notice, html: notice.html.replace("URGP", "ZZZZ") })).toBeNull();
    expect(isItauTransfer({ ...notice, from: "x@itau.com.uy.example" })).toBe(false);
  });
});
