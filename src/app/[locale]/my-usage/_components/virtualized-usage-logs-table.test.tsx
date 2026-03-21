import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import type { MyUsageLogEntry } from "@/actions/my-usage";

let mockLogs: MyUsageLogEntry[] = [];
let mockIsLoading = false;
let mockIsError = false;
let mockError: unknown = null;
let mockHasNextPage = false;
let mockIsFetchingNextPage = false;
let lastInfiniteQueryOptions: Record<string, unknown> | null = null;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (options: Record<string, unknown>) => {
    lastInfiniteQueryOptions = options;
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
    getTotalSize: () => mockLogs.length * 48,
    getVirtualItems: () => [
      ...mockLogs.map((_, index) => ({
        index,
        start: index * 48,
        size: 48,
      })),
      ...(mockHasNextPage
        ? [{ index: mockLogs.length, start: mockLogs.length * 48, size: 48 }]
        : []),
    ],
  }),
}));

vi.mock("@/actions/my-usage", () => ({
  getMyUsageLogsBatch: vi.fn(),
}));

vi.mock("@/components/customs/model-vendor-icon", () => ({
  ModelVendorIcon: () => <span data-slot="model-icon" />,
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

// Must import after mocks are set up
import { VirtualizedUsageLogsTable } from "./virtualized-usage-logs-table";

function makeLog(overrides: Partial<MyUsageLogEntry>): MyUsageLogEntry {
  return {
    id: 1,
    createdAt: new Date(),
    model: "claude-3-opus",
    billingModel: null,
    anthropicEffort: null,
    modelRedirect: null,
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.01,
    statusCode: 200,
    duration: 1000,
    endpoint: "/v1/messages",
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
    cacheCreation5mInputTokens: null,
    cacheCreation1hInputTokens: null,
    cacheTtlApplied: null,
    ...overrides,
  };
}

function resetMocks() {
  mockLogs = [];
  mockIsLoading = false;
  mockIsError = false;
  mockError = null;
  mockHasNextPage = false;
  mockIsFetchingNextPage = false;
  lastInfiniteQueryOptions = null;
}

describe("VirtualizedUsageLogsTable", () => {
  test("renders loading state", () => {
    resetMocks();
    mockIsLoading = true;

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("animate-spin");
    expect(html).toContain("loadingMore");
  });

  test("renders error state", () => {
    resetMocks();
    mockIsError = true;
    mockError = new Error("something went wrong");

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("something went wrong");
  });

  test("renders empty state", () => {
    resetMocks();

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("noLogs");
  });

  test("renders log rows with model and status", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1, model: "claude-sonnet-4-20250514", statusCode: 200 })];

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("claude-sonnet-4-20250514");
    // Status badge with green border for 200
    expect(html).toContain("border-green-500");
    expect(html).toContain("200");
  });

  test("renders loader row when hasNextPage", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1 })];
    mockHasNextPage = true;

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    // Loader row should render with spinner
    expect(html).toContain("animate-spin");
  });

  test("shows loadingMore when fetching next page", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1 })];
    mockIsFetchingNextPage = true;

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("loadingMore");
  });

  test("shows noMoreData when all loaded", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1 })];
    mockHasNextPage = false;

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("noMoreData");
  });

  test("does not set maxPages in infinite query options", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1 })];

    renderToStaticMarkup(<VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />);

    expect(lastInfiniteQueryOptions).not.toBeNull();
    expect(lastInfiniteQueryOptions).not.toHaveProperty("maxPages");
  });

  test("renders cache TTL badge when cacheTtlApplied is set", () => {
    resetMocks();
    mockLogs = [
      makeLog({
        id: 1,
        cacheTtlApplied: "5m",
        cacheCreationInputTokens: 1200,
      }),
    ];

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} autoRefreshEnabled={false} />
    );
    expect(html).toContain("5m");
    expect(html).toContain("bg-blue-50");
  });

  test("renders cost with currency symbol", () => {
    resetMocks();
    mockLogs = [makeLog({ id: 1, cost: 0.1234 })];

    const html = renderToStaticMarkup(
      <VirtualizedUsageLogsTable filters={{}} currencyCode="USD" autoRefreshEnabled={false} />
    );
    // USD symbol + formatted cost
    expect(html).toContain("$");
    expect(html).toContain("0.1234");
  });
});
