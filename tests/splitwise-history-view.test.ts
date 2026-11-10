import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BalanceHistory } from "@/app/splitwise/Activity";
const observation = { friendId: 1, person: "Example", currency: "USD", amount: "-1.00", observedAt: "2026-01-01T00:00:00.000Z" };
describe("balance history accessibility", () => {
  it("keeps observations accessible even when a line cannot be drawn", () => {
    const html = renderToStaticMarkup(createElement(BalanceHistory, { entries: [observation] }));
    expect(html).toContain("View all 1 observed values");
    expect(html).toContain("USD -1.00");
    expect(html).not.toContain("<svg");
  });
  it("discloses the chart window and retains older observations in the table", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ ...observation, observedAt: new Date(Date.UTC(2026, 0, 30 - i)).toISOString() }));
    const html = renderToStaticMarkup(createElement(BalanceHistory, { entries }));
    expect(html).toContain("Chart: 24 most recent observations");
    expect(html).toContain("View all 30 observed values");
    expect(html).toContain("2026-01-01");
  });
});
