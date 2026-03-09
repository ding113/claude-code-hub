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

// --- Hoisted mocks ---

const mockGetUserInsightsOverview = vi.hoisted(() => vi.fn());
const mockGetUserInsightsKeyTrend = vi.hoisted(() => vi.fn());
const mockGetUserInsightsModelBreakdown = vi.hoisted(() => vi.fn());

vi.mock("@/actions/admin-user-insights", () => ({
  getUserInsightsOverview: mockGetUserInsightsOverview,
  getUserInsightsKeyTrend: mockGetUserInsightsKeyTrend,
  getUserInsightsModelBreakdown: mockGetUserInsightsModelBreakdown,
}));

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
          todayRequests: 42,
          todayCost: 1.23,
          avgResponseTime: 850,
          todayErrorRate: 2.5,
          yesterdaySamePeriodRequests: 30,
          yesterdaySamePeriodCost: 1.0,
          yesterdaySamePeriodAvgResponseTime: 900,
          recentMinuteRequests: 3,
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
});

describe("UserOverviewCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          todayRequests: 42,
          todayCost: 1.23,
          avgResponseTime: 850,
          todayErrorRate: 2.5,
          yesterdaySamePeriodRequests: 30,
          yesterdaySamePeriodCost: 1.0,
          yesterdaySamePeriodAvgResponseTime: 900,
          recentMinuteRequests: 3,
        },
        currencyCode: "USD",
      },
    });

    const { UserOverviewCards } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-overview-cards"
    );

    const { container, unmount } = renderWithProviders(<UserOverviewCards userId={10} />);

    await flushMicrotasks();

    const cards = container.querySelectorAll("[data-testid^='user-insights-metric-']");
    expect(cards.length).toBe(4);

    const todayRequests = container.querySelector(
      "[data-testid='user-insights-metric-todayRequests']"
    );
    expect(todayRequests).not.toBeNull();
    expect(todayRequests!.textContent).toContain("42");

    const avgResponseTime = container.querySelector(
      "[data-testid='user-insights-metric-avgResponseTime']"
    );
    expect(avgResponseTime).not.toBeNull();
    expect(avgResponseTime!.textContent).toContain("850ms");

    const errorRate = container.querySelector("[data-testid='user-insights-metric-errorRate']");
    expect(errorRate).not.toBeNull();
    expect(errorRate!.textContent).toContain("2.5%");

    unmount();
  });

  it("shows loading skeletons while fetching", async () => {
    // Never resolves to keep loading state
    mockGetUserInsightsOverview.mockReturnValue(new Promise(() => {}));

    const { UserOverviewCards } = await import(
      "@/app/[locale]/dashboard/leaderboard/user/[userId]/_components/user-overview-cards"
    );

    const { container, unmount } = renderWithProviders(<UserOverviewCards userId={10} />);

    await flushMicrotasks();

    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);

    unmount();
  });
});

describe("UserKeyTrendChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
