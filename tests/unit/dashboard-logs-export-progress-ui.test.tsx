/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UsageLogsFilters } from "@/app/[locale]/dashboard/logs/_components/usage-logs-filters";
import dashboardMessages from "../../messages/en/dashboard.json";

const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

const {
  downloadUsageLogsExportMock,
  getUsageLogsExportStatusMock,
  startUsageLogsExportMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  startUsageLogsExportMock: vi.fn(),
  getUsageLogsExportStatusMock: vi.fn(),
  downloadUsageLogsExportMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/actions/usage-logs", () => ({
  startUsageLogsExport: startUsageLogsExportMock,
  getUsageLogsExportStatus: getUsageLogsExportStatusMock,
  downloadUsageLogsExport: downloadUsageLogsExportMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/active-filters-display", () => ({
  ActiveFiltersDisplay: () => <div data-testid="active-filters-display" />,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/filter-section", () => ({
  FilterSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/identity-filters", () => ({
  IdentityFilters: () => <div data-testid="identity-filters" />,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/quick-filters-bar", () => ({
  QuickFiltersBar: () => <div data-testid="quick-filters-bar" />,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/request-filters", () => ({
  RequestFilters: ({
    onFiltersChange,
  }: {
    onFiltersChange: (filters: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      data-testid="request-filters"
      onClick={() => onFiltersChange({ sessionId: "draft-session" })}
    >
      Draft Request Filters
    </button>
  ),
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/status-filters", () => ({
  StatusFilters: () => <div data-testid="status-filters" />,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/filters/time-filters", () => ({
  TimeFilters: () => <div data-testid="time-filters" />,
}));

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ dashboard: dashboardMessages }}
        timeZone="UTC"
      >
        {node}
      </NextIntlClientProvider>
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

async function actClick(el: Element | null) {
  if (!el) throw new Error("element not found");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("UsageLogsFilters export progress UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:usage-logs");
    globalThis.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    document.body.innerHTML = "";
  });

  test("shows export progress while polling and downloads when completed", async () => {
    startUsageLogsExportMock.mockResolvedValue({ ok: true, data: { jobId: "job-1" } });
    getUsageLogsExportStatusMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          jobId: "job-1",
          status: "running",
          processedRows: 50,
          totalRows: 200,
          progressPercent: 25,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          jobId: "job-1",
          status: "completed",
          processedRows: 200,
          totalRows: 200,
          progressPercent: 100,
        },
      });
    downloadUsageLogsExportMock.mockResolvedValue({ ok: true, data: "\uFEFFTime,User\n" });

    const { container, unmount } = renderWithIntl(
      <UsageLogsFilters
        isAdmin={true}
        providers={[]}
        initialKeys={[]}
        filters={{}}
        onChange={() => {}}
        onReset={() => {}}
      />
    );

    const exportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === "Export"
    );

    await actClick(exportButton ?? null);
    await flushPromises();

    expect(container.textContent).toContain("Exported 50 / 200");
    expect(container.textContent).toContain("25%");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await flushPromises();

    expect(downloadUsageLogsExportMock).toHaveBeenCalledWith("job-1");
    expect(toastSuccessMock).toHaveBeenCalledWith("Export completed successfully");
    expect(toastErrorMock).not.toHaveBeenCalled();

    unmount();
  });

  test("exports the applied filters instead of unapplied local draft filters", async () => {
    startUsageLogsExportMock.mockResolvedValue({ ok: true, data: { jobId: "job-2" } });
    getUsageLogsExportStatusMock.mockResolvedValueOnce({
      ok: true,
      data: {
        jobId: "job-2",
        status: "completed",
        processedRows: 1,
        totalRows: 1,
        progressPercent: 100,
      },
    });
    downloadUsageLogsExportMock.mockResolvedValue({ ok: true, data: "\uFEFFTime,User\n" });

    const { container, unmount } = renderWithIntl(
      <UsageLogsFilters
        isAdmin={true}
        providers={[]}
        initialKeys={[]}
        filters={{ sessionId: "applied-session" }}
        onChange={() => {}}
        onReset={() => {}}
      />
    );

    await actClick(container.querySelector("[data-testid='request-filters']"));

    const exportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === "Export"
    );

    await actClick(exportButton ?? null);
    await flushPromises();

    expect(startUsageLogsExportMock).toHaveBeenCalledWith({ sessionId: "draft-session" });

    unmount();
  });
});
