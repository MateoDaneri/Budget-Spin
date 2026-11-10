import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyStack } from "@/app/components/MoneyStack";

describe("money display accessibility", () => {
  it("includes the displayed amount and currency-switch action in the accessible name", () => {
    const html = renderToStaticMarkup(createElement(MoneyStack, { values: [
      { currencyCode: "UYU", value: "-UYU 58,500.00" },
      { currencyCode: "USD", value: "USD 1,500.00" }
    ] }));
    expect(html).toContain('aria-label="-UYU 58,500.00. Shown in UYU; activate to show USD."');
    expect(html).toContain('data-compact="true"');
  });
});
