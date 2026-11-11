import { describe, expect, it } from "vitest";
import { merchantKey } from "@/src/finance/merchant-key";

describe("merchantKey", () => {
  it("gives the same key to one merchant across store numbers", () => {
    expect(merchantKey("MERCADO DE PRUEBA 9")).toBe("mercado de prueba");
    expect(merchantKey("MERCADO DE PRUEBA 12")).toBe("mercado de prueba");
    expect(merchantKey("MERCADO DE PRUEBA #0042")).toBe("mercado de prueba");
  });

  it("strips a trailing id and the single location word after it in the card-notice shape", () => {
    expect(merchantKey("COMERCIO DE PRUEBA*TEST*00 ABCDE")).toBe("comercio de prueba test");
    expect(merchantKey("COMERCIO DE PRUEBA*TEST*17 FGHIJ")).toBe("comercio de prueba test");
    expect(merchantKey("COMERCIO DE PRUEBA*TEST*00")).toBe("comercio de prueba test");
  });

  it("keeps different merchants apart", () => {
    expect(merchantKey("KIOSCO INVENTADO 3")).not.toBe(merchantKey("KIOSCO FICTICIO 3"));
    expect(merchantKey("PAGOS*TIENDA UNO")).not.toBe(merchantKey("PAGOS*TIENDA DOS"));
    expect(merchantKey("MERCADO DE PRUEBA CENTRO")).not.toBe(merchantKey("MERCADO DE PRUEBA NORTE"));
  });

  it("does not drop a letters-only word that is not preceded by an id", () => {
    expect(merchantKey("COMERCIO MONTE")).toBe("comercio monte");
    expect(merchantKey("24 HORAS")).toBe("24 horas");
  });

  it("normalises unicode, case and whitespace", () => {
    expect(merchantKey("  Café   Ejemplo\t 5 ")).toBe("café ejemplo");
    expect(merchantKey("Café EJEMPLO 7")).toBe("café ejemplo");
    expect(merchantKey("ＣＡＦÉ ＥＪＥＭＰＬＯ ８")).toBe("café ejemplo");
  });

  it("returns null when the result is too generic", () => {
    expect(merchantKey("AB 123")).toBeNull();
    expect(merchantKey("")).toBeNull();
    expect(merchantKey("   ")).toBeNull();
  });

  it("returns null for input made only of digits and symbols", () => {
    expect(merchantKey("123 456-789 *** #00")).toBeNull();
    expect(merchantKey("$$$ %%% 12/34")).toBeNull();
  });

  it("caps very long input and stays fast", () => {
    const long = `TIENDA FICTICIA ${"x".repeat(100_000)} ${"9 ".repeat(50_000)}`;
    const started = performance.now();
    const key = merchantKey(long);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(key).not.toBeNull();
    expect(key!.length).toBeLessThanOrEqual(256);
    expect(key!.startsWith("tienda ficticia ")).toBe(true);
  });
});
