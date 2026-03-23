import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useInfiniteQuery: vi.fn(),
  getMyUsageLogs: vi.fn(),
  getMyUsageLogsBatch: vi.fn(),
  getMyAvailableModels: vi.fn(),
  getMyAvailableEndpoints: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useTimeZone: () => "UTC",
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: mocks.useInfiniteQuery,
}));

vi.mock("@/actions/my-usage", () => ({
  getMyUsageLogs: mocks.getMyUsageLogs,
  getMyUsageLogsBatch: mocks.getMyUsageLogsBatch,
  getMyAvailableModels: mocks.getMyAvailableModels,
  getMyAvailableEndpoints: mocks.getMyAvailableEndpoints,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/logs-date-range-picker", () => ({
  LogsDateRangePicker: () => <div data-testid="logs-date-range-picker" />,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <div />,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: ReactNode }) => <label>{children}</label>,
}));

vi.mock("./usage-logs-table", () => ({
  UsageLogsTable: () => <div data-testid="usage-logs-table" />,
}));

import { UsageLogsSection } from "./usage-logs-section";

describe("my-usage usage logs section", () => {
  test("uses infinite query instead of the old page-based getMyUsageLogs flow", async () => {
    let capturedQueryFn:
      | ((context: {
          pageParam?: { createdAt: string; id: number } | undefined;
        }) => Promise<unknown>)
      | undefined;

    mocks.useInfiniteQuery.mockImplementation((options: { queryFn: typeof capturedQueryFn }) => {
      capturedQueryFn = options.queryFn;
      return {
        data: { pages: [{ logs: [], nextCursor: null, hasMore: false }] },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: false,
        error: null,
      };
    });
    mocks.getMyUsageLogsBatch.mockResolvedValue({
      ok: true,
      data: {
        logs: [],
        nextCursor: null,
        hasMore: false,
        currencyCode: "USD",
        billingModelSource: "original",
      },
    });
    mocks.getMyUsageLogs.mockResolvedValue({
      ok: true,
      data: { logs: [], total: 0, page: 1, pageSize: 20, currencyCode: "USD" },
    });
    mocks.getMyAvailableModels.mockResolvedValue({ ok: true, data: [] });
    mocks.getMyAvailableEndpoints.mockResolvedValue({ ok: true, data: [] });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<UsageLogsSection defaultOpen />);
    });

    await act(async () => {
      await capturedQueryFn?.({ pageParam: undefined });
    });

    expect(mocks.useInfiniteQuery).toHaveBeenCalled();
    expect(mocks.getMyUsageLogsBatch).toHaveBeenCalled();
    expect(mocks.getMyUsageLogs).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
