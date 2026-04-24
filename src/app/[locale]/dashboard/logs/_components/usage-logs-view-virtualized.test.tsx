import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageLogFilters } from "./filters/types";

const routerMocks = vi.hoisted(() => ({
  pushedHref: "",
  push: vi.fn((href: string) => {
    routerMocks.pushedHref = href.startsWith("/") ? `/zh-CN${href}` : href;
  }),
}));

const searchParamMocks = vi.hoisted(() => ({
  value: new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamMocks.value,
  useRouter: () => {
    throw new Error("logs navigation must use the locale-aware i18n router");
  },
}));

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({
    push: routerMocks.push,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({
    supported: false,
    isFullscreen: false,
    request: vi.fn(),
    exit: vi.fn(),
  }),
}));

vi.mock("@/lib/column-visibility", () => ({
  getHiddenColumns: () => [],
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: () => <button type="button" role="switch" />,
}));

vi.mock("./column-visibility-dropdown", () => ({
  ColumnVisibilityDropdown: () => <div data-testid="column-visibility-dropdown" />,
}));

vi.mock("./usage-logs-stats-panel", () => ({
  UsageLogsStatsPanel: () => <div data-testid="usage-logs-stats-panel" />,
}));

vi.mock("./virtualized-logs-table", () => ({
  VirtualizedLogsTable: () => <div data-testid="virtualized-logs-table" />,
}));

vi.mock("./usage-logs-filters", () => ({
  UsageLogsFilters: ({
    onChange,
    onReset,
  }: {
    onChange: (filters: UsageLogFilters) => void;
    onReset: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange({
            userId: 2,
            keyId: 3,
            providerId: 4,
            sessionId: "session-abc",
            startTime: 1000,
            endTime: 2000,
            statusCode: 500,
            model: "claude-sonnet",
            endpoint: "/v1/messages",
            minRetryCount: 1,
          })
        }
      >
        apply all filters
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            excludeStatusCode200: true,
          })
        }
      >
        apply exclude 200
      </button>
      <button type="button" onClick={onReset}>
        reset filters
      </button>
    </div>
  ),
}));

import { UsageLogsViewVirtualized } from "./usage-logs-view-virtualized";

function renderUsageLogsView() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <UsageLogsViewVirtualized
        isAdmin={true}
        userId={1}
        providers={[]}
        initialKeys={[]}
        searchParams={{}}
        currencyCode="USD"
        billingModelSource="original"
      />
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

function clickButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("UsageLogsViewVirtualized filter navigation", () => {
  beforeEach(() => {
    routerMocks.pushedHref = "";
    routerMocks.push.mockClear();
    searchParamMocks.value = new URLSearchParams();
    document.body.innerHTML = "";
  });

  it("applies every logs filter through the locale-aware dashboard route", () => {
    const { container, unmount } = renderUsageLogsView();

    clickButton(container, "apply all filters");

    expect(routerMocks.pushedHref).toBe(
      "/zh-CN/dashboard/logs?userId=2&keyId=3&providerId=4&sessionId=session-abc&startTime=1000&endTime=2000&statusCode=500&model=claude-sonnet&endpoint=%2Fv1%2Fmessages&minRetry=1"
    );

    unmount();
  });

  it("applies exclude-200 status filter through the locale-aware dashboard route", () => {
    const { container, unmount } = renderUsageLogsView();

    clickButton(container, "apply exclude 200");

    expect(routerMocks.pushedHref).toBe("/zh-CN/dashboard/logs?statusCode=%21200");

    unmount();
  });

  it("resets logs filters through the locale-aware dashboard route", () => {
    const { container, unmount } = renderUsageLogsView();

    clickButton(container, "reset filters");

    expect(routerMocks.pushedHref).toBe("/zh-CN/dashboard/logs");

    unmount();
  });
});
