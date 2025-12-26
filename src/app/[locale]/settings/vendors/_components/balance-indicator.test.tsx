import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BalanceIndicator } from "./balance-indicator";

describe("BalanceIndicator", () => {
  test("renders placeholder when balance is unknown", () => {
    const html = renderToStaticMarkup(<BalanceIndicator balanceUsd={null} />);
    expect(html).toContain("-");
    expect(html).toContain('data-slot="badge"');
  });

  test("renders red badge when balance is below threshold", () => {
    const html = renderToStaticMarkup(<BalanceIndicator balanceUsd={5} lowThresholdUsd={10} />);
    expect(html).toContain("$5.00");
    expect(html).toContain("bg-red-50");
    expect(html).toContain("dark:bg-red-950");
  });

  test("renders green badge when balance is above threshold", () => {
    const html = renderToStaticMarkup(<BalanceIndicator balanceUsd={15} lowThresholdUsd={10} />);
    expect(html).toContain("$15.00");
    expect(html).toContain("bg-green-50");
    expect(html).toContain("dark:bg-green-950");
  });
});
