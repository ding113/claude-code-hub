import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import type { MyUsageLogEntry } from "@/actions/my-usage";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useTimeZone: () => "UTC",
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("@/components/customs/model-vendor-icon", () => ({
  ModelVendorIcon: () => <span data-testid="model-vendor-icon" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} />,
}));

vi.mock("@/hooks/use-virtualized-infinite-list", () => ({
  useVirtualizedInfiniteList: () => ({
    parentRef: { current: null },
    rowVirtualizer: {
      getTotalSize: () => 80,
    },
    virtualItems: [
      {
        index: 0,
        start: 0,
        size: 80,
      },
    ],
    showScrollToTop: false,
    handleScroll: vi.fn(),
    scrollToTop: vi.fn(),
    resetScrollPosition: vi.fn(),
  }),
}));

import { UsageLogsTable } from "./usage-logs-table";

function makeLog(overrides: Partial<MyUsageLogEntry> = {}): MyUsageLogEntry {
  return {
    id: 1,
    createdAt: new Date("2026-03-21T00:00:00Z"),
    model: "gpt-4.1",
    billingModel: "gpt-4.1",
    anthropicEffort: null,
    modelRedirect: null,
    inputTokens: 10,
    outputTokens: 20,
    cost: 0.01,
    statusCode: 200,
    duration: 50,
    endpoint: "/v1/messages",
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    cacheTtlApplied: null,
    ...overrides,
  };
}

describe("my-usage usage logs table", () => {
  test("shows a non-blocking error message even when stale logs are still visible", () => {
    const html = renderToStaticMarkup(
      <UsageLogsTable
        logs={[makeLog()]}
        hasNextPage={false}
        isFetchingNextPage={false}
        errorMessage="load failed"
      />
    );

    expect(html).toContain("load failed");
    expect(html).toContain("logs.table.loadedCount");
    expect(html).toContain("gpt-4.1");
  });
});
