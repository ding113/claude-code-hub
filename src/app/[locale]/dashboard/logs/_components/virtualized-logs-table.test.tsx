import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, vi } from "vitest";

import type { UsageLogRow } from "@/repository/usage-logs";

let mockLogs: UsageLogRow[] = [];
let mockIsLoading = false;
let mockIsError = false;
let mockError: unknown = null;
let mockHasNextPage = false;
let mockIsFetchingNextPage = false;
const useInfiniteQuerySpy = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "logs.billingDetails.unitPricePer1M" && values?.price ? `@ ${values.price} / 1M` : key,
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (options: unknown) => {
    useInfiniteQuerySpy(options);
    return {
      data: { pages: [{ logs: mockLogs, nextCursor: null, hasMore: false }] },
      fetchNextPage: vi.fn(),
      hasNextPage: mockHasNextPage,
      isFetchingNextPage: mockIsFetchingNextPage,
      isLoading: mockIsLoading,
      isError: mockIsError,
      error: mockError,
    };
  },
}));

vi.mock("@/hooks/use-virtualizer", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => mockLogs.length * 52,
    getVirtualItems: () => [
      ...mockLogs.map((_, index) => ({
        index,
        start: index * 52,
        size: 52,
      })),
      ...(mockHasNextPage
        ? [
            {
              index: mockLogs.length,
              start: mockLogs.length * 52,
              size: 52,
            },
          ]
        : []),
    ],
  }),
}));

vi.mock("@/lib/utils/provider-chain-formatter", () => ({
  formatProviderSummary: () => "provider summary",
  getFinalProviderName: () => "mock-provider",
  getRetryCount: () => 0,
  isHedgeRace: () => false,
  isActualRequest: () => true,
}));

vi.mock("@/actions/usage-logs", () => ({
  getUsageLogsBatch: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children, className }: ComponentProps<"div">) => (
    <div data-slot="tooltip-content" className={className}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, className, ...props }: ComponentProps<"button">) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: React.ComponentProps<"span">) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: ({ fallback }: { fallback: string }) => <span>{fallback}</span>,
}));

vi.mock("./model-display-with-redirect", () => ({
  ModelDisplayWithRedirect: ({ currentModel }: { currentModel: string | null }) => (
    <span>{currentModel ?? "-"}</span>
  ),
}));

vi.mock("./error-details-dialog", () => ({
  ErrorDetailsDialog: () => <div data-slot="error-details-dialog" />,
}));

let mockIsProviderFinalized = true;
vi.mock("@/lib/utils/provider-display", () => ({
  isProviderFinalized: () => mockIsProviderFinalized,
}));

import { VirtualizedLogsTable } from "./virtualized-logs-table";

function makeLog(overrides: Partial<UsageLogRow>): UsageLogRow {
  return {
    id: 1,
    createdAt: new Date(),
    sessionId: null,
    requestSequence: null,
    userName: "u",
    keyName: "k",
    providerName: "p",
    model: "m",
    originalModel: null,
    endpoint: "/v1/messages",
    statusCode: 200,
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    cacheTtlApplied: null,
    totalTokens: 2,
    costUsd: "0.01",
    costMultiplier: null,
    groupCostMultiplier: null,
    costBreakdown: null,
    durationMs: 100,
    ttfbMs: 50,
    errorMessage: null,
    providerChain: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    clientIp: null,
    messagesCount: null,
    context1mApplied: null,
    swapCacheTtlApplied: null,
    specialSettings: null,
    ...overrides,
  };
}

function renderTableWithLog(overrides: Partial<UsageLogRow>) {
  mockIsLoading = false;
  mockIsError = false;
  mockError = null;
  mockHasNextPage = false;
  mockIsFetchingNextPage = false;
  mockLogs = [makeLog({ id: 1, ...overrides })];

  return renderToStaticMarkup(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />);
}

function renderCostTooltipWithLog(overrides: Partial<UsageLogRow>) {
  const html = renderTableWithLog(overrides);
  const container = document.createElement("div");
  container.innerHTML = html;

  const tooltip = [...container.querySelectorAll('[data-slot="tooltip-content"]')].find((node) =>
    node.textContent?.includes("logs.details.billingDetails.title")
  );

  if (!(tooltip instanceof HTMLDivElement)) {
    throw new Error("Cost tooltip content not found");
  }

  return tooltip;
}

describe("virtualized-logs-table multiplier badge", () => {
  test("does not cap cached pages so deep scroll can return to the latest rows", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = true;
    mockIsFetchingNextPage = false;
    mockLogs = [makeLog({ id: 1 })];
    useInfiniteQuerySpy.mockClear();

    renderToStaticMarkup(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />);

    const options = useInfiniteQuerySpy.mock.calls[0]?.[0] as { maxPages?: number } | undefined;
    expect(options).toBeDefined();
    expect(options?.maxPages).toBeUndefined();
  });

  test("renders loading/error/empty states", () => {
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    mockIsLoading = true;
    mockLogs = [];
    expect(
      renderToStaticMarkup(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />)
    ).toContain("logs.stats.loading");

    mockIsLoading = false;
    mockIsError = true;
    mockError = new Error("boom");
    expect(
      renderToStaticMarkup(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />)
    ).toContain("boom");

    mockIsError = false;
    mockError = null;
    mockLogs = [];
    expect(
      renderToStaticMarkup(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />)
    ).toContain("logs.table.noData");
  });

  test("does not render cost multiplier badge for null/undefined/empty/NaN/Infinity", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    for (const costMultiplier of [null, undefined, "", "NaN", "Infinity"] as const) {
      mockLogs = [makeLog({ id: 1, costMultiplier })];
      const html = renderToStaticMarkup(
        <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
      );
      expect(html).not.toContain("xNaN");
      expect(html).not.toContain("xInfinity");
      expect(html).not.toContain("x0.00");
    }
  });

  test("renders cost multiplier badge when finite and != 1", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    mockLogs = [makeLog({ id: 1, costMultiplier: "0.2" })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("x0.20");
  });

  test("shows scroll-to-top button after scroll and triggers scrollTo", async () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;
    mockLogs = [makeLog({ id: 1, costMultiplier: null })];

    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createRoot(container);
    await act(async () => {
      root.render(<VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />);
    });

    const scroller = container.querySelector(
      "div.h-\\[600px\\].overflow-auto"
    ) as HTMLDivElement | null;
    expect(scroller).not.toBeNull();

    if (scroller) {
      // happy-dom may not implement scrollTo; stub for assertion
      const scrollToMock = vi.fn();
      (scroller as unknown as { scrollTo: typeof scrollToMock }).scrollTo = scrollToMock;
      await act(async () => {
        scroller.scrollTop = 600;
        scroller.dispatchEvent(new Event("scroll"));
      });

      expect(container.innerHTML).toContain("logs.table.scrollToTop");

      const button = container.querySelector("button.fixed") as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(scrollToMock).toHaveBeenCalled();
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("renders blocked badge and loader row when applicable", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = true;
    mockIsFetchingNextPage = false;

    mockLogs = [makeLog({ id: 1, blockedBy: "sensitive_word" })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("logs.table.blocked");

    // Loader row should render when hasNextPage=true
    expect(html).toContain("animate-spin");
  });

  test("hides provider column when hiddenColumns includes provider", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    mockLogs = [makeLog({ id: 1, providerName: "provider" })];

    const htmlWithProvider = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(htmlWithProvider).toContain("logs.columns.provider");

    const htmlHidden = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} hiddenColumns={["provider"]} />
    );
    expect(htmlHidden).not.toContain("logs.columns.provider");
  });

  test("renders provider chain and fetching state when enabled", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = true;
    mockIsFetchingNextPage = true;

    mockLogs = [
      makeLog({
        id: 1,
        costMultiplier: null,
        providerChain: [{ id: 1, name: "p1", reason: "request_success", statusCode: 200 }],
      }),
    ];

    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    // VirtualizedLogsTable uses ProviderChainPopover which renders the provider name
    // via getFinalProviderName (mocked to return "mock-provider")
    expect(html).toContain("mock-provider");
    expect(html).toContain("logs.table.loadingMore");
  });

  test("hides tok/s when TTFB is close to duration and rate is abnormally high", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    // Rule: generationTimeMs / durationMs < 0.1 && outputRate > 5000 => hide tok/s
    // durationMs=1000, ttfbMs=950 => generationTimeMs=50, ratio=0.05 < 0.1
    // outputTokens=300 => rate = 300 / 0.05 = 6000 > 5000 => should hide
    mockLogs = [makeLog({ id: 1, durationMs: 1000, ttfbMs: 950, outputTokens: 300 })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    // tok/s should NOT appear
    expect(html).not.toContain("tok/s");
    // TTFB should still appear
    expect(html).toContain("TTFB");
  });

  test("shows tok/s when conditions are normal", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    // durationMs=1000, ttfbMs=500 => generationTimeMs=500, ratio=0.5 >= 0.1
    // outputTokens=50 => rate = 50 / 0.5 = 100 <= 5000 => should show
    mockLogs = [makeLog({ id: 1, durationMs: 1000, ttfbMs: 500, outputTokens: 50 })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    // tok/s should appear
    expect(html).toContain("tok/s");
    // TTFB should also appear
    expect(html).toContain("TTFB");
  });

  test("renders swap indicator on cacheTtl badge when swapCacheTtlApplied is true", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    mockLogs = [makeLog({ id: 1, cacheTtlApplied: "5m", swapCacheTtlApplied: true })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    expect(html).toContain("5m ~");
    expect(html).toContain("bg-amber-50");
  });

  test("does not render swap indicator when swapCacheTtlApplied is false", () => {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;

    mockLogs = [makeLog({ id: 1, cacheTtlApplied: "5m", swapCacheTtlApplied: false })];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    expect(html).toContain("5m");
    expect(html).not.toContain("5m ~");
    expect(html).not.toContain("bg-amber-50");
  });

  test("renders redesigned cost tooltip with positive rows and active multiplier rules only", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.009000",
      inputTokens: 2000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 500,
      context1mApplied: true,
      costBreakdown: {
        input: "0.005",
        output: "0",
        cache_creation: "0",
        cache_creation_5m: "0",
        cache_creation_1h: "0",
        cache_read: "0.000125",
        base_total: "0.005125",
        provider_multiplier: 1.5,
        group_multiplier: 1.2,
        total: "0.009225",
      },
    });

    expect(tooltip.textContent).toContain("logs.details.billingDetails.title");
    expect(tooltip.textContent).toContain("logs.billingDetails.context1m");
    expect(tooltip.textContent).toContain("logs.billingDetails.input");
    expect(tooltip.textContent).toContain("logs.billingDetails.cacheRead");
    expect(tooltip.textContent).toContain("@ $2.50 / 1M");
    expect(tooltip.textContent).toContain("$0.005000");
    expect(tooltip.textContent).toContain("@ $0.25 / 1M");
    expect(tooltip.textContent).toContain("$0.000125");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.output");
    expect(tooltip.textContent).not.toContain("@ $0.00 / 1M");
    expect(tooltip.textContent).toContain("logs.billingDetails.baseTotal");
    expect(tooltip.textContent).toContain("logs.billingDetails.providerMultiplier");
    expect(tooltip.textContent).toContain("logs.billingDetails.groupMultiplier");
    expect(tooltip.innerHTML).toContain("line-through");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.pricingProvider");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.pricingSourceLabel");
  });

  test("keeps cost rows but collapses the summary to a single total row when no multiplier is active", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.005125",
      inputTokens: 2000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 500,
      costBreakdown: {
        input: "0.005",
        output: "0",
        cache_creation: "0",
        cache_creation_5m: "0",
        cache_creation_1h: "0",
        cache_read: "0.000125",
        base_total: "0.005125",
        provider_multiplier: 1,
        group_multiplier: 1,
        total: "0.005125",
      },
    });

    expect(tooltip.textContent).toContain("logs.billingDetails.input");
    expect(tooltip.textContent).toContain("logs.billingDetails.cacheRead");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.baseTotal");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.providerMultiplier");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.groupMultiplier");
    expect(tooltip.innerHTML).not.toContain("line-through");
  });

  test("ignores zero or negative multipliers in the rules block", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.005125",
      inputTokens: 2000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 500,
      costBreakdown: {
        input: "0.005",
        output: "0",
        cache_creation: "0",
        cache_creation_5m: "0",
        cache_creation_1h: "0",
        cache_read: "0.000125",
        base_total: "0.005125",
        provider_multiplier: 0,
        group_multiplier: -2,
        total: "0.005125",
      },
    });

    expect(tooltip.textContent).toContain("logs.billingDetails.input");
    expect(tooltip.textContent).toContain("logs.billingDetails.cacheRead");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.baseTotal");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.providerMultiplier");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.groupMultiplier");
    expect(tooltip.textContent).not.toContain("0.00x");
    expect(tooltip.textContent).not.toContain("-2.00x");
    expect(tooltip.innerHTML).not.toContain("line-through");
  });

  test("renders legacy aggregate cache creation as a generic cache-write row when ttl is unknown", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.003000",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1000,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheTtlApplied: null,
      costBreakdown: {
        input: "0",
        output: "0",
        cache_creation: "0.003",
        cache_read: "0",
        base_total: "0.003",
        provider_multiplier: 1,
        group_multiplier: 1,
        total: "0.003",
      },
    });

    expect(tooltip.textContent).toContain("logs.columns.cacheWrite");
    expect(tooltip.textContent).toContain("@ $3.00 / 1M");
    expect(tooltip.textContent).toContain("$0.003000");
    expect(tooltip.innerHTML).not.toContain(">5m<");
    expect(tooltip.innerHTML).not.toContain(">1h<");
  });

  test("keeps a ttl chip for aggregate cache creation when ttl is explicitly known", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.003000",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1000,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheTtlApplied: "1h",
      costBreakdown: {
        input: "0",
        output: "0",
        cache_creation: "0.003",
        cache_read: "0",
        base_total: "0.003",
        provider_multiplier: 1,
        group_multiplier: 1,
        total: "0.003",
      },
    });

    expect(tooltip.textContent).toContain("logs.columns.cacheWrite");
    expect(tooltip.textContent).toContain("@ $3.00 / 1M");
    expect(tooltip.innerHTML).toContain(">1h<");
    expect(tooltip.innerHTML).not.toContain(">5m<");
  });

  test("falls back to total-only tooltip when cost breakdown is missing", () => {
    const tooltip = renderCostTooltipWithLog({
      costUsd: "0.010000",
      inputTokens: 1234,
      outputTokens: 5678,
      cacheCreationInputTokens: 999,
      cacheReadInputTokens: 111,
      context1mApplied: true,
      costBreakdown: null,
    });

    expect(tooltip.textContent).toContain("logs.details.billingDetails.title");
    expect(tooltip.textContent).toContain("logs.billingDetails.context1m");
    expect(tooltip.textContent).toContain("logs.billingDetails.totalCost");
    expect(tooltip.textContent).toContain("$0.010000");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.input");
    expect(tooltip.textContent).not.toContain("@ $");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.baseTotal");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.providerMultiplier");
    expect(tooltip.textContent).not.toContain("logs.billingDetails.pricingProvider");
  });
});

describe("virtualized-logs-table live chain display", () => {
  function setupLiveChainDefaults() {
    mockIsLoading = false;
    mockIsError = false;
    mockError = null;
    mockHasNextPage = false;
    mockIsFetchingNextPage = false;
    mockIsProviderFinalized = false;
  }

  test("renders provider name from live chain when unfinalised", () => {
    setupLiveChainDefaults();
    mockLogs = [
      makeLog({
        id: 1,
        statusCode: null,
        providerChain: null,
        _liveChain: {
          chain: [{ id: 1, name: "openai-east", reason: "initial_selection" }],
          phase: "provider_selected",
          updatedAt: Date.now(),
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("openai-east");
    expect(html).toContain("animate-spin");
  });

  test("renders retrying badge when phase is retrying", () => {
    setupLiveChainDefaults();
    mockLogs = [
      makeLog({
        id: 1,
        statusCode: null,
        providerChain: null,
        _liveChain: {
          chain: [
            { id: 1, name: "p1", reason: "initial_selection" },
            { id: 2, name: "p2", reason: "retry_failed" },
          ],
          phase: "retrying",
          updatedAt: Date.now(),
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("logs.details.retrying");
    expect(html).toContain("text-amber-500");
  });

  test("renders GitBranch icon when phase is hedge_racing", () => {
    setupLiveChainDefaults();
    mockLogs = [
      makeLog({
        id: 1,
        statusCode: null,
        providerChain: null,
        _liveChain: {
          chain: [{ id: 1, name: "p1", reason: "hedge_triggered" }],
          phase: "hedge_racing",
          updatedAt: Date.now(),
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("text-indigo-500");
  });

  test("renders generic in-progress when live chain is empty", () => {
    setupLiveChainDefaults();
    mockLogs = [
      makeLog({
        id: 1,
        statusCode: null,
        providerChain: null,
        _liveChain: {
          chain: [],
          phase: "queued",
          updatedAt: Date.now(),
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("logs.details.inProgress");
  });

  test("renders generic spinner when no live chain data", () => {
    setupLiveChainDefaults();
    mockLogs = [
      makeLog({
        id: 1,
        statusCode: null,
        providerChain: null,
        _liveChain: undefined,
      }),
    ];
    const html = renderToStaticMarkup(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("logs.details.inProgress");
    expect(html).toContain("animate-spin");
  });
});
