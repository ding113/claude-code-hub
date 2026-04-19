import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyAvailableModels: vi.fn(),
  getMyAvailableEndpoints: vi.fn(),
  getMyUsageLogsBatchFull: vi.fn(),
  getMyUsageMetadata: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useTimeZone: () => "UTC",
}));

vi.mock("@/actions/my-usage", () => ({
  getMyAvailableModels: mocks.getMyAvailableModels,
  getMyAvailableEndpoints: mocks.getMyAvailableEndpoints,
  getMyUsageLogsBatchFull: mocks.getMyUsageLogsBatchFull,
  getMyUsageMetadata: mocks.getMyUsageMetadata,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/logs-date-range-picker", () => ({
  LogsDateRangePicker: () => <div data-testid="logs-date-range-picker" />,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/virtualized-logs-table", () => ({
  VirtualizedLogsTable: (props: {
    hiddenColumns?: string[];
    disableDetailDialog?: boolean;
    fetchFn?: unknown;
    queryKeyPrefix?: string;
    ipLookupMode?: string;
  }) => (
    <div
      data-testid="virtualized-logs-table"
      data-hidden-columns={JSON.stringify(props.hiddenColumns)}
      data-disable-detail-dialog={String(props.disableDetailDialog)}
      data-query-key-prefix={props.queryKeyPrefix}
      data-has-fetch-fn={String(!!props.fetchFn)}
      data-ip-lookup-mode={props.ipLookupMode}
    />
  ),
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

import { UsageLogsSection } from "./usage-logs-section";

describe("my-usage usage logs section", () => {
  test("renders VirtualizedLogsTable with correct restrictions", async () => {
    mocks.getMyAvailableModels.mockResolvedValue({ ok: true, data: [] });
    mocks.getMyAvailableEndpoints.mockResolvedValue({ ok: true, data: [] });
    mocks.getMyUsageMetadata.mockResolvedValue({
      ok: true,
      data: { currencyCode: "USD", billingModelSource: "original" },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<UsageLogsSection defaultOpen />);
    });

    const table = container.querySelector('[data-testid="virtualized-logs-table"]');
    expect(table).toBeTruthy();

    // Verify user/key/provider columns are hidden
    const hiddenColumns = JSON.parse(table!.getAttribute("data-hidden-columns") ?? "[]");
    expect(hiddenColumns).toContain("user");
    expect(hiddenColumns).toContain("key");
    expect(hiddenColumns).toContain("provider");

    // Verify detail dialog is disabled
    expect(table!.getAttribute("data-disable-detail-dialog")).toBe("true");

    // Verify custom fetch function and query key
    expect(table!.getAttribute("data-has-fetch-fn")).toBe("true");
    expect(table!.getAttribute("data-query-key-prefix")).toBe("my-usage-logs-batch");
    expect(table!.getAttribute("data-ip-lookup-mode")).toBe("my-usage");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
