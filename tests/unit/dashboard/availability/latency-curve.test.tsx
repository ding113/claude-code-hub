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
    LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) =>
      React.createElement(
        "div",
        { "data-testid": "recharts-linechart", "data-points": data?.length || 0 },
        children
      ),
    Line: ({
      stroke,
      dataKey,
      dot,
      activeDot,
    }: {
      stroke: string;
      dataKey: string;
      dot: unknown;
      activeDot: unknown;
    }) =>
      React.createElement("div", {
        "data-testid": `recharts-line-${dataKey}`,
        "data-stroke": stroke,
        "data-has-dot": dot != null ? "true" : "false",
        "data-activedot": JSON.stringify(activeDot),
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

import { LatencyCurve } from "@/app/[locale]/dashboard/availability/_components/endpoint/latency-curve";
import type { ProviderEndpointProbeLog } from "@/types/provider";

const mockLogs: ProviderEndpointProbeLog[] = [
  {
    id: 1,
    endpointId: 1,
    ok: true,
    statusCode: 200,
    latencyMs: 120,
    createdAt: "2024-01-01T10:00:00Z",
    errorMessage: null,
  },
  {
    id: 2,
    endpointId: 1,
    ok: true,
    statusCode: 200,
    latencyMs: 150,
    createdAt: "2024-01-01T10:05:00Z",
    errorMessage: null,
  },
  {
    id: 3,
    endpointId: 1,
    ok: false,
    statusCode: 500,
    latencyMs: 200,
    createdAt: "2024-01-01T10:10:00Z",
    errorMessage: "Internal Server Error",
  },
];

function renderComponent(logs: ProviderEndpointProbeLog[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<LatencyCurve logs={logs} />);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("LatencyCurve color bindings", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("ChartConfig uses var(--chart-*) without hsl wrapper", () => {
    const { container, unmount } = renderComponent(mockLogs);

    const chartContainer = container.querySelector('[data-testid="chart-container"]');
    expect(chartContainer).toBeTruthy();

    const configStr = chartContainer?.getAttribute("data-config");
    expect(configStr).toBeTruthy();

    const config = JSON.parse(configStr!);

    // Color should use var(--chart-*) directly, NOT hsl(var(--primary)) or hsl(var(--chart-*))
    expect(config.latency.color).toBe("var(--chart-1)");

    // Ensure no hsl wrapper
    expect(config.latency.color).not.toMatch(/^hsl\(/);

    unmount();
  });

  test("Line stroke uses var(--color-latency) CSS variable", () => {
    const { container, unmount } = renderComponent(mockLogs);

    const line = container.querySelector('[data-testid="recharts-line-latency"]');
    expect(line).toBeTruthy();

    // Stroke should use var(--color-latency) injected by ChartContainer
    expect(line?.getAttribute("data-stroke")).toBe("var(--color-latency)");

    unmount();
  });

  test("renders no data message when logs are empty", () => {
    const { container, unmount } = renderComponent([]);

    // Should show no data message
    expect(container.textContent).toContain("noData");
    // Should not render chart
    expect(container.querySelector('[data-testid="chart-container"]')).toBeNull();

    unmount();
  });

  test("renders no data message when all logs have null latency", () => {
    const logsWithNullLatency: ProviderEndpointProbeLog[] = [
      {
        id: 1,
        endpointId: 1,
        ok: false,
        statusCode: null,
        latencyMs: null,
        createdAt: "2024-01-01T10:00:00Z",
        errorMessage: "Timeout",
      },
    ];

    const { container, unmount } = renderComponent(logsWithNullLatency);

    // Should show no data message
    expect(container.textContent).toContain("noData");
    // Should not render chart
    expect(container.querySelector('[data-testid="chart-container"]')).toBeNull();

    unmount();
  });
});
