import { describe, expect, it } from "vitest";
import {
  isItauStatement,
  parseStatementItems,
  type StatementText,
} from "@/src/ingest/itau-statement";
const row = (y: number, ...items: Array<[number, string]>): StatementText[] =>
  items.map(([x, str]) => ({ x, y, str }));
const fixture = () => [
  [
    ...row(727, [491, "01/01/2026"]),
    ...row(690, [132, "10/01/2026"], [206, "10/02/2026"]),
    ...row(674, [275, "X.X./10/01/2026"]),
    ...row(592, [50, "SALDO DEL ESTADO DE CUENTA ANTERIOR"]),
    ...row(500, [50, "SALDO CONTADO"], [430, "1.234,56"], [490, "-20,00"]),
  ],
];
describe("Visa statement summary", () => {
  it("recognizes only the bank sender and expected subject", () => {
    expect(
      isItauStatement({
        from: "avisos@itau.com.uy",
        subject: "Envio de estado de cuenta Visa Itau",
      }),
    ).toBe(true);
    expect(
      isItauStatement({
        from: "avisos@itau.com.uy.example",
        subject: "Envio de estado de cuenta Visa Itau",
      }),
    ).toBe(false);
  });
  it("extracts only validated summary fields and current due date", () =>
    expect(parseStatementItems(fixture())).toEqual({
      issuedOn: "2026-01-01",
      dueDate: "2026-01-10",
      totalUyuMinor: 123456,
      totalUsdMinor: -2000,
    }));
  it("rejects contradictory repeated due dates and duplicate totals", () => {
    const p = fixture();
    p[0].find((x) => x.y === 674)!.str = "X.X./11/01/2026";
    expect(parseStatementItems(p)).toBeNull();
    const q = fixture();
    q[0].push(...row(500, [435, "1,00"]));
    expect(parseStatementItems(q)).toBeNull();
  });
  it("rejects invalid dates, missing anchors, changed layout and oversized documents", () => {
    const p = fixture();
    p[0][0].str = "31/02/2026";
    expect(parseStatementItems(p)).toBeNull();
    expect(
      parseStatementItems([
        [...row(500, [50, "SALDO CONTADO"], [430, "1,00"])],
      ]),
    ).toBeNull();
    expect(
      parseStatementItems(Array.from({ length: 13 }, () => [])),
    ).toBeNull();
  });
});
