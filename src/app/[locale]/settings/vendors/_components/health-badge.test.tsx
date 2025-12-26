import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { HealthBadge } from "./health-badge";

describe("HealthBadge", () => {
  test("renders healthy state", () => {
    const html = renderToStaticMarkup(<HealthBadge status="healthy" statusCode={200} />);
    expect(html).toContain("200");
    expect(html).toContain("bg-green-50");
    expect(html).toContain("dark:bg-green-950");
  });

  test("renders unhealthy state", () => {
    const html = renderToStaticMarkup(
      <HealthBadge status="unhealthy" statusCode={500} errorMessage="boom" />
    );
    expect(html).toContain("500");
    expect(html).toContain("bg-red-50");
    expect(html).toContain("dark:bg-red-950");
  });

  test("renders unknown state", () => {
    const html = renderToStaticMarkup(<HealthBadge status="unknown" />);
    expect(html).toContain("-");
    expect(html).toContain("bg-muted/50");
  });
});
