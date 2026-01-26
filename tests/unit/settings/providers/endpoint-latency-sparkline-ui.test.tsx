/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EndpointLatencySparkline } from "@/app/[locale]/settings/providers/_components/endpoint-latency-sparkline";

const providerEndpointsActionMocks = vi.hoisted(() => ({
  getProviderEndpointProbeLogs: vi.fn(async () => ({ ok: true, data: { logs: [] as any[] } })),
}));
vi.mock("@/actions/provider-endpoints", () => providerEndpointsActionMocks);

vi.mock("recharts", async () => {
  const React = await import("react");
  return {
    ResponsiveContainer: ({ children }: any) =>
      React.createElement("div", { "data-testid": "recharts-responsive" }, children),
    LineChart: ({ children, data }: any) =>
      React.createElement(
        "div",
        { "data-testid": "recharts-linechart", "data-points": JSON.stringify(data) },
        children
      ),
    YAxis: () => null,
    Line: ({ stroke, dataKey }: any) =>
      React.createElement("div", {
        "data-testid": "recharts-line",
        "data-stroke": stroke,
        "data-key": dataKey,
      }),
    Tooltip: () => React.createElement("div", { "data-testid": "recharts-tooltip" }),
  };
});

let queryClient: QueryClient;

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushTicks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("EndpointLatencySparkline", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("无日志时渲染占位块", async () => {
    providerEndpointsActionMocks.getProviderEndpointProbeLogs.mockResolvedValueOnce({
      ok: true,
      data: { logs: [] },
    });

    const { container, unmount } = renderWithProviders(
      <EndpointLatencySparkline endpointId={123} limit={12} />
    );

    await flushTicks(5);

    expect(container.querySelector('[data-testid="recharts-line"]')).toBeNull();
    expect(container.querySelector('div[class*="bg-muted/20"]')).not.toBeNull();

    unmount();
  });

  test("有日志时使用最近一次探测的 ok 状态决定线条颜色", async () => {
    providerEndpointsActionMocks.getProviderEndpointProbeLogs.mockResolvedValueOnce({
      ok: true,
      data: {
        logs: [
          { ok: true, latencyMs: 120 },
          { ok: false, latencyMs: 200 },
        ],
      },
    } as any);

    const { container, unmount } = renderWithProviders(
      <EndpointLatencySparkline endpointId={123} limit={2} />
    );

    await flushTicks(5);

    expect(providerEndpointsActionMocks.getProviderEndpointProbeLogs).toHaveBeenCalledWith({
      endpointId: 123,
      limit: 2,
    });

    const line = container.querySelector('[data-testid="recharts-line"]') as HTMLElement | null;
    expect(line).toBeTruthy();
    expect(line?.getAttribute("data-key")).toBe("latencyMs");
    expect(line?.getAttribute("data-stroke")).toBe("#16a34a");

    unmount();
  });

  test("最近一次探测为失败时使用红色线条", async () => {
    providerEndpointsActionMocks.getProviderEndpointProbeLogs.mockResolvedValueOnce({
      ok: true,
      data: {
        logs: [
          { ok: false, latencyMs: 120 },
          { ok: true, latencyMs: 200 },
        ],
      },
    } as any);

    const { container, unmount } = renderWithProviders(
      <EndpointLatencySparkline endpointId={123} limit={2} />
    );

    await flushTicks(5);

    const line = container.querySelector('[data-testid="recharts-line"]') as HTMLElement | null;
    expect(line).toBeTruthy();
    expect(line?.getAttribute("data-stroke")).toBe("#dc2626");

    unmount();
  });
});
