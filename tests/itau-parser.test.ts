import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseItauAviso, type ItauEmailInput } from "@/src/ingest/itau-parser";

const html = readFileSync(path.resolve(__dirname, "fixtures/itau-aviso-consumo.html"), "utf8");

function baseInput(overrides: Partial<ItauEmailInput> = {}): ItauEmailInput {
  return {
    subject: "Aviso de consumo aprobado con tarjeta de crédito",
    from: "comunicaciones@itau.com.uy",
    date: new Date("2026-06-22T20:04:29.000Z"),
    messageId: "<fixture-001@email.amazonses.com>",
    html,
    ...overrides
  };
}

describe("parseItauAviso", () => {
  it("extracts amount, currency, merchant and card from a real-shaped aviso", () => {
    const parsed = parseItauAviso(baseInput());

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      messageId: "<fixture-001@email.amazonses.com>",
      txnDateIso: "2026-06-22T20:04:29.000Z",
      amountRaw: "199.0",
      currencyCode: "UYU",
      merchant: "COMERCIO DE PRUEBA*TEST*00 ABCDE",
      cardNetwork: "VISA",
      cardLast4: "1234"
    });
  });

  it("does not let the merchant bleed into the following sentence", () => {
    const parsed = parseItauAviso(baseInput());
    expect(parsed?.merchant).not.toMatch(/ingresando/i);
  });

  it("returns null for non-Itaú senders", () => {
    expect(parseItauAviso(baseInput({ from: "phish@evil.example" }))).toBeNull();
  });

  it("rejects a lookalike sender domain", () => {
    expect(parseItauAviso(baseInput({ from: "comunicaciones@itau.com.uy.evil.example" }))).toBeNull();
  });

  it("returns null for unrelated Itaú subjects", () => {
    expect(parseItauAviso(baseInput({ subject: "Tu resumen mensual está disponible" }))).toBeNull();
  });

  it("parses a USD aviso (bimonetary card) — real format 192.57 USD", () => {
    const usd = html.replace("199.0", "192.57").replace(">UYU<", ">USD<");
    const parsed = parseItauAviso(baseInput({ html: usd }));
    expect(parsed).toMatchObject({ amountRaw: "192.57", currencyCode: "USD" });
  });

  it("keeps amounts over 1000 as dot-decimal (Itaú uses no thousands separator)", () => {
    const big = html.replace("199.0", "2021.0");
    const parsed = parseItauAviso(baseInput({ html: big }));
    expect(parsed?.amountRaw).toBe("2021.0");
  });

  it("collapses the wide internal spacing Itaú pads merchants with", () => {
    const padded = html.replace("COMERCIO DE PRUEBA*TEST*00   ABCDE", "COMERCIO                  MONTE");
    const parsed = parseItauAviso(baseInput({ html: padded }));
    expect(parsed?.merchant).toBe("COMERCIO MONTE");
  });

  it("parses the normal card line with bounded patterns", () => {
    const parsed = parseItauAviso(baseInput({ html: html.replace("<b>VISA</b> nro. ***<b>1234</b>", "<b>MASTER</b> nro. ****<b>9876</b>") }));
    expect(parsed).toMatchObject({ cardNetwork: "MASTER", cardLast4: "9876", amountRaw: "199.0", currencyCode: "UYU" });
  });

  it("returns quickly on a large adversarial letters-only body", () => {
    const adversarial = `Importe: 199.0 UYU<br>Comercio: TEST<br>${"a".repeat(200_000)}<${"<".repeat(1000)}`;
    const started = performance.now();
    const parsed = parseItauAviso(baseInput({ html: adversarial }));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(parsed).toMatchObject({ amountRaw: "199.0", cardNetwork: null, cardLast4: null });
  });

  it("normalizes Uruguayan thousands notation defensively (unused by Itaú, kept as a safety net)", () => {
    const big = html.replace("199.0", "1.234,56");
    const parsed = parseItauAviso(baseInput({ html: big }));
    expect(parsed?.amountRaw).toBe("1234.56");
  });
});
