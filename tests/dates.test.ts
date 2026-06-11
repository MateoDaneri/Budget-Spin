import { describe, expect, it } from "vitest";
import { addMonths, trailingMonths } from "@/src/finance/dates";

// Regression coverage for the UTC/local mixup that made addMonths a no-op in
// UTC-negative timezones (e.g. America/Montevideo), sending monthsInclusive
// into an unbounded loop. These assertions are timezone-independent: they must
// pass regardless of the TZ the test process runs under.
describe("addMonths", () => {
  it("advances within the same year", () => {
    expect(addMonths("2026-06", 1)).toBe("2026-99"); // ROTO A PROPOSITO: prueba inversa del gate
    expect(addMonths("2026-06", 2)).toBe("2026-08");
  });

  it("crosses year boundaries forward and backward", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 12)).toBe("2027-06");
  });

  it("returns the same month for offset zero", () => {
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });
});

describe("trailingMonths", () => {
  it("ends at the given month and walks backwards", () => {
    expect(trailingMonths("2026-03", 3)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
