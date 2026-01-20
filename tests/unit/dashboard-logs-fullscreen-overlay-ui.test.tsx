import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi, beforeEach } from "vitest";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastMocks.error,
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ toString: () => "" }),
}));

const invalidateQueriesMock = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();

  return {
    ...actual,
    useQuery: () => ({ data: undefined, isLoading: false }),
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  };
});

const fullscreenMocks = vi.hoisted(() => ({
  request: vi.fn(async () => {}),
  exit: vi.fn(async () => {}),
}));

vi.mock("@/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({
    supported: true,
    isFullscreen: false,
    request: fullscreenMocks.request,
    exit: fullscreenMocks.exit,
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));

vi.mock("../../src/app/[locale]/dashboard/logs/_components/virtualized-logs-table", () => ({
  VirtualizedLogsTable: (props: any) => (
    <div
      data-testid="virtualized-logs-table"
      data-overlay={props.hideStatusBar ? "1" : "0"}
      data-hidden={(props.hiddenColumns ?? []).join(",")}
    />
  ),
}));

vi.mock("../../src/app/[locale]/dashboard/logs/_components/usage-logs-filters", () => ({
  UsageLogsFilters: () => <div data-testid="usage-logs-filters" />,
}));

vi.mock("../../src/app/[locale]/dashboard/logs/_components/usage-logs-stats-panel", () => ({
  UsageLogsStatsPanel: () => <div data-testid="usage-logs-stats" />,
}));

vi.mock("../../src/app/[locale]/dashboard/logs/_utils/logs-query", () => ({
  buildLogsUrlQuery: () => new URLSearchParams(),
  parseLogsUrlFilters: () => ({}),
}));

import { UsageLogsViewVirtualized } from "../../src/app/[locale]/dashboard/logs/_components/usage-logs-view-virtualized";

function findButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes(text)
  );
}

async function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("UsageLogsViewVirtualized fullscreen overlay", () => {
  beforeEach(() => {
    fullscreenMocks.request.mockClear();
    fullscreenMocks.exit.mockClear();
    invalidateQueriesMock.mockClear();
    toastMocks.error.mockClear();
    document.body.innerHTML = "";
  });

  test("opens overlay and calls fullscreen.request; switch toggles provider hiddenColumns", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
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

    await click(findButtonByText(container, "logs.actions.fullscreen") ?? null);

    expect(fullscreenMocks.request).toHaveBeenCalledWith(document.documentElement);
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    const switchEl = container.querySelector(
      '[role="switch"][aria-label="logs.table.hideProviderColumn"]'
    );
    await click(switchEl);

    const overlayTable = container.querySelector(
      '[data-testid="virtualized-logs-table"][data-overlay="1"]'
    ) as HTMLElement | null;
    expect(overlayTable?.getAttribute("data-hidden")).toBe("provider");

    await click(findButtonByText(container, "logs.actions.exitFullscreen") ?? null);
    expect(fullscreenMocks.exit).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  test("when fullscreen.request rejects, it should not open overlay and should toast an error", async () => {
    fullscreenMocks.request.mockRejectedValueOnce(new Error("denied"));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
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

    await click(findButtonByText(container, "logs.actions.fullscreen") ?? null);

    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
