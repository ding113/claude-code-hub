/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock recharts to expose color props via data-* attributes
vi.mock("recharts", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      React.createElement("div", { "data-testid": "recharts-responsive" }, children),
    AreaChart: ({ children, data }: { children: ReactNode; data: unknown[] }) =>
      React.createElement(
        "div",
        { "data-testid": "recharts-areachart", "data-points": data?.length || 0 },
        children
      ),
    Area: ({ stroke, fill, dataKey }: { stroke: string; fill: string; dataKey: string }) =>
      React.createElement("div", {
        "data-testid": `recharts-area-${dataKey}`,
        "data-stroke": stroke,
        "data-fill": fill,
      }),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

// Mock chart.tsx to expose ChartStyle for testing
vi.mock("@/components/ui/chart", async () => {
  const React = await import("react");
  const actual =
    await vi.importActual<typeof import("@/components/ui/chart")>("@/components/ui/chart");
  return {
    ...actual,
    ChartContainer: ({
      children,
      config,
      className,
    }: {
      children: ReactNode;
      config: Record<string, { color?: string; label?: string }>;
      className?: string;
    }) =>
      React.createElement(
        "div",
        {
          "data-testid": "chart-container",
          "data-config": JSON.stringify(config),
          className,
        },
        children
      ),
    ChartTooltip: () => null,
  };
});

import { LatencyChart } from "@/app/[locale]/dashboard/availability/_components/provider/latency-chart";
import type { ProviderAvailabilitySummary } from "@/lib/availability";

const mockProviders: ProviderAvailabilitySummary[] = [
  {
    provider: "test-provider",
    uptime: 99.5,
    totalRequests: 100,
    successRequests: 99,
    failedRequests: 1,
    avgLatencyMs: 150,
    p50LatencyMs: 120,
    p95LatencyMs: 200,
    p99LatencyMs: 350,
    timeBuckets: [
      {
        bucketStart: "2024-01-01T10:00:00Z",
        totalRequests: 50,
        successRequests: 49,
        failedRequests: 1,
        avgLatencyMs: 140,
        p50LatencyMs: 110,
        p95LatencyMs: 190,
        p99LatencyMs: 340,
      },
      {
        bucketStart: "2024-01-01T11:00:00Z",
        totalRequests: 50,
        successRequests: 50,
        failedRequests: 0,
        avgLatencyMs: 160,
        p50LatencyMs: 130,
        p95LatencyMs: 210,
        p99LatencyMs: 360,
      },
    ],
  },
];

function renderComponent(providers: ProviderAvailabilitySummary[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<LatencyChart providers={providers} />);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("LatencyChart color bindings", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("ChartConfig uses var(--chart-*) without hsl wrapper", () => {
    const { container, unmount } = renderComponent(mockProviders);

    const chartContainer = container.querySelector('[data-testid="chart-container"]');
    expect(chartContainer).toBeTruthy();

    const configStr = chartContainer?.getAttribute("data-config");
    expect(configStr).toBeTruthy();

    const config = JSON.parse(configStr!);

    // Colors should use var(--chart-*) directly, NOT hsl(var(--chart-*))
    expect(config.p50.color).toBe("var(--chart-2)");
    expect(config.p95.color).toBe("var(--chart-4)");
    expect(config.p99.color).toBe("var(--chart-1)");

    // Ensure no hsl wrapper
    expect(config.p50.color).not.toMatch(/^hsl\(/);
    expect(config.p95.color).not.toMatch(/^hsl\(/);
    expect(config.p99.color).not.toMatch(/^hsl\(/);

    unmount();
  });

  test("Area stroke uses var(--color-<key>) CSS variable", () => {
    const { container, unmount } = renderComponent(mockProviders);

    const areaP50 = container.querySelector('[data-testid="recharts-area-p50"]');
    const areaP95 = container.querySelector('[data-testid="recharts-area-p95"]');
    const areaP99 = container.querySelector('[data-testid="recharts-area-p99"]');

    expect(areaP50).toBeTruthy();
    expect(areaP95).toBeTruthy();
    expect(areaP99).toBeTruthy();

    // Stroke should use var(--color-<key>) injected by ChartContainer
    expect(areaP50?.getAttribute("data-stroke")).toBe("var(--color-p50)");
    expect(areaP95?.getAttribute("data-stroke")).toBe("var(--color-p95)");
    expect(areaP99?.getAttribute("data-stroke")).toBe("var(--color-p99)");

    unmount();
  });

  test("Area fill references gradient with correct ID pattern", () => {
    const { container, unmount } = renderComponent(mockProviders);

    const areaP50 = container.querySelector('[data-testid="recharts-area-p50"]');
    const areaP95 = container.querySelector('[data-testid="recharts-area-p95"]');
    const areaP99 = container.querySelector('[data-testid="recharts-area-p99"]');

    // Fill should reference gradient URL
    expect(areaP50?.getAttribute("data-fill")).toMatch(/url\(#fillP50\)/);
    expect(areaP95?.getAttribute("data-fill")).toMatch(/url\(#fillP95\)/);
    expect(areaP99?.getAttribute("data-fill")).toMatch(/url\(#fillP99\)/);

    unmount();
  });

  test("renders no data message when providers have no time buckets with requests", () => {
    const emptyProviders: ProviderAvailabilitySummary[] = [
      {
        provider: "empty-provider",
        uptime: 0,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        timeBuckets: [],
      },
    ];

    const { container, unmount } = renderComponent(emptyProviders);

    // Should show no data message
    expect(container.textContent).toContain("noData");
    // Should not render chart
    expect(container.querySelector('[data-testid="chart-container"]')).toBeNull();

    unmount();
  });
});
