import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { CachePerformance } from "./CachePerformance";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

const messages = {
  dashboard: {
    logs: {
      details: {
        cachePerformance: {
          title: "Cache Performance",
          actualRate: "Actual Cache Rate",
          theoreticalRate: "Theoretical Cache Rate",
          coefficient: "Request Cache Coefficient",
          rawCoefficient: "Raw coefficient",
          estimateNote: "Estimated",
          availability: {
            available: "Available",
            no_input: "No input",
            no_affinity_key: "No Prefix ID",
            attempt_failed: "Attempt failed",
            not_observable: "Not observable",
            stream_truncated: "Stream truncated",
            legacy_unrecorded: "Legacy",
          },
        },
      },
    },
  },
};

function renderMetrics(props: React.ComponentProps<typeof CachePerformance>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CachePerformance {...props} />
    </NextIntlClientProvider>
  );
}

describe("CachePerformance", () => {
  test("renders all three request-level metrics and token provenance", () => {
    const html = renderMetrics({
      actualCacheRate: 0.25,
      theoreticalCacheRate: 0.5,
      requestCacheCoefficientBp: 5000,
      requestCacheMetricAvailability: "available",
      cacheInputTotal: 200,
      cacheReadInputTokens: 50,
      theoreticalCacheTokens: 100,
    });

    expect(html).toContain("25.0%");
    expect(html).toContain("50.0%");
    expect(html).toContain("0.50");
    expect(html).toContain("50 / 200");
    expect(html).toContain("100 / 200");
  });

  test("renders unavailable values and the reason instead of zero", () => {
    const html = renderMetrics({
      actualCacheRate: 0,
      theoreticalCacheRate: null,
      requestCacheCoefficientBp: null,
      requestCacheMetricAvailability: "no_affinity_key",
      cacheInputTotal: 100,
      cacheReadInputTokens: 0,
      theoreticalCacheTokens: null,
    });

    expect(html).toContain("0.0%");
    expect(html.match(/–/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("No Prefix ID");
  });
});
