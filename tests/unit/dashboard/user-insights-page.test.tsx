/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dashboardMessages from "@messages/en/dashboard.json";
import myUsageMessages from "@messages/en/myUsage.json";
import commonMessages from "@messages/en/common.json";
import { resolveTimePresetDates } from "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/filters/types";

// --- Hoisted mocks ---

const mockGetUserInsightsOverview = vi.hoisted(() => vi.fn());
const mockGetUserInsightsKeyTrend = vi.hoisted(() => vi.fn());
const mockGetUserInsightsModelBreakdown = vi.hoisted(() => vi.fn());
const mockGetUserInsightsProviderBreakdown = vi.hoisted(() => vi.fn());

vi.mock("@/actions/admin-user-insights", () => ({
  getUserInsightsOverview: mockGetUserInsightsOverview,
  getUserInsightsKeyTrend: mockGetUserInsightsKeyTrend,
  getUserInsightsModelBreakdown: mockGetUserInsightsModelBreakdown,
  getUserInsightsProviderBreakdown: mockGetUserInsightsProviderBreakdown,
}));

// The dashboard now reads via v1 hooks; mirror the legacy mock fns by invoking
// them and exposing a synchronous React Query–shaped result. Tests call
// `mock.mockResolvedValue(...)` ahead of render, so we read the queued value
// via mock.results and resolve it inline. The cache is shared across the file
// and cleared in beforeEach to keep tests isolated.
async function unwrapPromise(promise: unknown): Promise<unknown> {
  if (!(promise instanceof Promise)) return promise;
  const value = await promise;
  if (value && typeof value === "object" && "ok" in (value as Record<string, unknown>)) {
    const r = value as { ok: boolean; data?: unknown };
    return r.ok ? r.data : undefined;
  }
  return value;
}

const insightsMockCache: Map<string, { data: unknown; loading: boolean }> = vi.hoisted(
  () => new Map()
);

vi.mock("@/lib/api-client/v1/admin-user-insights/hooks", async () => {
  const React = await import("react");

  function useMockedQuery(
    mock: ReturnType<typeof vi.fn>,
    cacheKey: string,
    args: unknown[]
  ): { data: unknown; isLoading: boolean; isError: boolean; isFetching: boolean; error: null } {
    const [, force] = React.useReducer((n: number) => n + 1, 0);

    React.useEffect(() => {
      const entry = insightsMockCache.get(cacheKey);
      if (entry && !entry.loading) return; // already resolved
      insightsMockCache.set(cacheKey, { data: undefined, loading: true });
      const promise = mock(...args);
      Promise.resolve(unwrapPromise(promise))
        .then((value) => {
          insightsMockCache.set(cacheKey, { data: value, loading: false });
          force();
        })
        .catch(() => {
          insightsMockCache.set(cacheKey, { data: undefined, loading: false });
          force();
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheKey]);

    const entry = insightsMockCache.get(cacheKey);
    return {
      data: entry?.data,
      isLoading: entry?.loading ?? true,
      isError: false,
      isFetching: entry?.loading ?? true,
      error: null,
    };
  }

  return {
    useUserInsightsOverview: (userId: number, params: { startDate: string; endDate: string }) =>
      useMockedQuery(
        mockGetUserInsightsOverview,
        `overview:${userId}:${params.startDate}:${params.endDate}`,
        [userId, params.startDate, params.endDate]
      ),
    useUserInsightsKeyTrend: (userId: number, params: { startDate: string; endDate: string }) =>
      useMockedQuery(
        mockGetUserInsightsKeyTrend,
        `keyTrend:${userId}:${params.startDate}:${params.endDate}`,
        [userId, params.startDate, params.endDate]
      ),
    useUserInsightsModelBreakdown: (
      userId: number,
      params: { startDate: string; endDate: string }
    ) =>
      useMockedQuery(
        mockGetUserInsightsModelBreakdown,
        `model:${userId}:${params.startDate}:${params.endDate}`,
        [userId, params.startDate, params.endDate]
      ),
    useUserInsightsProviderBreakdown: (
      userId: number,
      params: { startDate: string; endDate: string }
    ) =>
      useMockedQuery(
        mockGetUserInsightsProviderBreakdown,
        `provider:${userId}:${params.startDate}:${params.endDate}`,
        [userId, params.startDate, params.endDate]
      ),
  };
});

const routerPushMock = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/dashboard/leaderboard/user/10",
}));

// Mock recharts to avoid rendering issues in happy-dom
vi.mock("recharts", () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-area-chart">{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-responsive-container">{children}</div>
  ),
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
    config: unknown;
  }) => (
    <div data-testid="mock-chart-container" className={className}>
      {children}
    </div>
  ),
  ChartTooltip: () => null,
}));

// --- Test helpers ---

const messages = {
  dashboard: dashboardMessages,
  myUsage: myUsageMessages,
  common: commonMessages,
} as const;

let queryClient: QueryClient;

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

// --- Tests ---

describe("UserInsightsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insightsMockCache.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });

    // Default mocks that resolve
    mockGetUserInsightsOverview.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 10, name: "TestUser" },
        overview: {
          requestCount: 42,
          totalCost: 1.23,
          avgResponseTime: 850,
          errorRate: 2.5,
        },
        currencyCode: "USD",
      },
    });

    mockGetUserInsightsKeyTrend.mockResolvedValue({
      ok: true,
      data: [
        { key_id: 1, key_name: "key-a", date: "2026-03-08", api_calls: 10, total_cost: "0.5" },
        { key_id: 1, key_name: "key-a", date: "2026-03-09", api_calls: 15, total_cost: "0.8" },
      ],
    });

    mockGetUserInsightsModelBreakdown.mockResolvedValue({
      ok: true,
      data: {
        breakdown: [
          {
            model: "claude-sonnet-4-5-20250514",
            requests: 100,
            cost: 1.5,
            inputTokens: 5000,
            outputTokens: 3000,
            cacheCreationTokens: 1000,
            cacheReadTokens: 500,
          },
          {
            model: "gpt-4o",
            requests: 50,
            cost: 0.8,
            inputTokens: 2000,
            outputTokens: 1500,
            cacheCreationTokens: 200,
            cacheReadTokens: 100,
          },
        ],
        currencyCode: "USD",
      },
    });

    mockGetUserInsightsProviderBreakdown.mockResolvedValue({
      ok: true,
      data: {
        breakdown: [
          {
            providerId: 1,
            providerName: "Provider A",
            requests: 100,
            cost: 1.5,
            inputTokens: 5000,
            outputTokens: 3000,
            cacheCreationTokens: 1000,
            cacheReadTokens: 500,
          },
        ],
        currencyCode: "USD",
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("renders page title with userName", async () => {
    const { UserInsightsView } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-insights-view"
    );

    const { container, unmount } = renderWithProviders(
      <UserInsightsView userId={10} userName="TestUser" />
    );

    await flushMicrotasks();

    const page = container.querySelector("[data-testid='user-insights-page']");
    expect(page).not.toBeNull();

    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toContain("User Insights");
    expect(heading!.textContent).toContain("TestUser");
    expect(mockGetUserInsightsOverview).toHaveBeenCalledWith(
      10,
      resolveTimePresetDates("7days").startDate,
      resolveTimePresetDates("7days").endDate
    );

    unmount();
  });

  it("renders back button", async () => {
    const { UserInsightsView } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-insights-view"
    );

    const { container, unmount } = renderWithProviders(
      <UserInsightsView userId={10} userName="TestUser" />
    );

    await flushMicrotasks();

    const backButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Back to Leaderboard")
    );
    expect(backButton).not.toBeUndefined();

    act(() => {
      backButton!.click();
    });
    expect(routerPushMock).toHaveBeenCalledWith("/dashboard/leaderboard?scope=user");

    unmount();
  });

  it("refetches overview with resolved 30-day range when timeRange changes", async () => {
    const { UserInsightsView } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-insights-view"
    );

    const { container, unmount } = renderWithProviders(
      <UserInsightsView userId={10} userName="TestUser" />
    );

    await flushMicrotasks();

    const button = container.querySelector("[data-testid='user-insights-time-range-30days']");
    expect(button).not.toBeNull();

    act(() => {
      (button as HTMLButtonElement).click();
    });

    await flushMicrotasks();

    const { startDate, endDate } = resolveTimePresetDates("30days");
    expect(mockGetUserInsightsOverview).toHaveBeenLastCalledWith(10, startDate, endDate);

    unmount();
  });
});

describe("UserOverviewCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insightsMockCache.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("renders 4 metric cards", async () => {
    mockGetUserInsightsOverview.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 10, name: "TestUser" },
        overview: {
          requestCount: 42,
          totalCost: 1.23,
          avgResponseTime: 850,
          errorRate: 2.5,
        },
        currencyCode: "USD",
      },
    });

    const { UserOverviewCards } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-overview-cards"
    );

    const { container, unmount } = renderWithProviders(
      <UserOverviewCards userId={10} startDate="2026-03-01" endDate="2026-03-09" />
    );

    await flushMicrotasks();

    const cards = container.querySelectorAll("[data-testid^='user-insights-metric-']");
    expect(cards.length).toBe(4);

    const requestCount = container.querySelector(
      "[data-testid='user-insights-metric-requestCount']"
    );
    expect(requestCount).not.toBeNull();
    expect(requestCount!.textContent).toContain("42");

    const avgResponseTime = container.querySelector(
      "[data-testid='user-insights-metric-avgResponseTime']"
    );
    expect(avgResponseTime).not.toBeNull();
    expect(avgResponseTime!.textContent).toContain("850ms");

    const errorRate = container.querySelector("[data-testid='user-insights-metric-errorRate']");
    expect(errorRate).not.toBeNull();
    expect(errorRate!.textContent).toContain("2.5%");
    expect(mockGetUserInsightsOverview).toHaveBeenCalledWith(10, "2026-03-01", "2026-03-09");

    unmount();
  });

  it("shows loading skeletons while fetching", async () => {
    // Never resolves to keep loading state
    mockGetUserInsightsOverview.mockReturnValue(new Promise(() => {}));

    const { UserOverviewCards } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-overview-cards"
    );

    const { container, unmount } = renderWithProviders(
      <UserOverviewCards userId={10} startDate="2026-03-01" endDate="2026-03-09" />
    );

    await flushMicrotasks();

    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);

    unmount();
  });
});

describe("UserKeyTrendChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insightsMockCache.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("renders chart with timeRange prop", async () => {
    mockGetUserInsightsKeyTrend.mockResolvedValue({
      ok: true,
      data: [],
    });

    const { UserKeyTrendChart } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-key-trend-chart"
    );

    const { container, unmount } = renderWithProviders(
      <UserKeyTrendChart userId={10} timeRange="7days" />
    );

    await flushMicrotasks();

    // Time range buttons are now in the parent filter bar, not in this component
    // Chart should render without internal time range controls
    expect(container.querySelector("[data-testid='user-insights-time-range-today']")).toBeNull();

    unmount();
  });
});

describe("UserModelBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insightsMockCache.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("renders model breakdown items", async () => {
    mockGetUserInsightsModelBreakdown.mockResolvedValue({
      ok: true,
      data: {
        breakdown: [
          {
            model: "claude-sonnet-4-5-20250514",
            requests: 100,
            cost: 1.5,
            inputTokens: 5000,
            outputTokens: 3000,
            cacheCreationTokens: 1000,
            cacheReadTokens: 500,
          },
          {
            model: "gpt-4o",
            requests: 50,
            cost: 0.8,
            inputTokens: 2000,
            outputTokens: 1500,
            cacheCreationTokens: 200,
            cacheReadTokens: 100,
          },
        ],
        currencyCode: "USD",
      },
    });

    const { UserModelBreakdown } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-model-breakdown"
    );

    const { container, unmount } = renderWithProviders(<UserModelBreakdown userId={10} />);

    await flushMicrotasks();

    const breakdownList = container.querySelector(
      "[data-testid='user-insights-model-breakdown-list']"
    );
    expect(breakdownList).not.toBeNull();

    // Check model names appear
    expect(breakdownList!.textContent).toContain("claude-sonnet-4-5-20250514");
    expect(breakdownList!.textContent).toContain("gpt-4o");

    unmount();
  });
});
