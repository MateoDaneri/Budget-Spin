import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseItauAviso, type ItauEmailInput } from "@/src/ingest/itau-parser";

const html = readFileSync(path.resolve(__dirname, "fixtures/itau-debit-synthetic.html"), "utf8");
const input: ItauEmailInput = { subject: "Aviso de consumo aprobado con tarjeta de débito", from: "avisos@itau.com.uy", date: new Date("2026-01-01T12:00:00Z"), messageId: "<debit-synthetic@example.com>", html };
describe("synthetic Itaú debit purchase notices", () => {
  it("extracts the merchant and peso amount with grouped thousands", () => {
    expect(parseItauAviso(input)).toMatchObject({ merchant: "MERCADO DE PRUEBA 9", amountRaw: "1234.56", currencyCode: "UYU", messageId: input.messageId });
  });
  it("maps the observed dollars format without changing the amount", () => {
    expect(parseItauAviso({ ...input, html: html.replace("1,234.56 pesos", "12.34 dólares") })).toMatchObject({ amountRaw: "12.34", currencyCode: "USD" });
  });
  it("rejects transfers, lookalike senders and unsupported or ambiguous amounts", () => {
    expect(parseItauAviso({ ...input, subject: "Aviso de transferencia realizada" })).toBeNull();
    expect(parseItauAviso({ ...input, from: "x@itau.com.uy.attacker.test" })).toBeNull();
    expect(parseItauAviso({ ...input, html: html.replace("1,234.56 pesos", "1.234,56 pesos") })).toBeNull();
    expect(parseItauAviso({ ...input, html: html.replace("1,234.56 pesos", "1234 pesos") })).toBeNull();
    expect(parseItauAviso({ ...input, html: html.replace("Realizado en", "Transferencia a") })).toBeNull();
  });
});
