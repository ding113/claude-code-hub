import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
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

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ logs: mockLogs, nextCursor: null, hasMore: false }] },
    fetchNextPage: vi.fn(),
    hasNextPage: mockHasNextPage,
    isFetchingNextPage: mockIsFetchingNextPage,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: mockError,
  }),
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
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, className, ...props }: React.ComponentProps<"button">) => (
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
    durationMs: 100,
    ttfbMs: 50,
    errorMessage: null,
    providerChain: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    messagesCount: null,
    context1mApplied: null,
    swapCacheTtlApplied: null,
    specialSettings: null,
    ...overrides,
  };
}

describe("virtualized-logs-table multiplier badge", () => {
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
