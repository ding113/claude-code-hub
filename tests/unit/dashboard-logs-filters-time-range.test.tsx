/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { UsageLogsFilters } from "@/app/[locale]/dashboard/logs/_components/usage-logs-filters";
import dashboardMessages from "../../messages/en/dashboard.json";

vi.mock("@/app/[locale]/dashboard/logs/_components/logs-date-range-picker", () => ({
  LogsDateRangePicker: ({
    onDateRangeChange,
  }: {
    onDateRangeChange: (range: { startDate?: string; endDate?: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-date-range"
      onClick={() => onDateRangeChange({ startDate: "2026-01-01", endDate: "2026-01-02" })}
    >
      Mock Date Range
    </button>
  ),
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

describe("UsageLogsFilters - seconds-level time range", () => {
  test("defaults to full-day semantics (end is exclusive next-day 00:00:00)", async () => {
    const onChange = vi.fn();

    const { container, unmount } = renderWithIntl(
      <UsageLogsFilters
        isAdmin={false}
        providers={[]}
        initialKeys={[]}
        filters={{}}
        onChange={onChange}
        onReset={() => {}}
      />
    );

    await actClick(container.querySelector("[data-testid='mock-date-range']"));

    const timeInputs = Array.from(container.querySelectorAll("input[type='time']"));
    expect(timeInputs).toHaveLength(2);

    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "Apply Filter"
    );
    await actClick(applyBtn ?? null);

    const expectedStart = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
    const expectedEnd = new Date(2026, 0, 3, 0, 0, 0, 0).getTime();

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: expectedStart, endTime: expectedEnd })
    );

    unmount();
  });

  test("Apply drops leaked page field from runtime filters object", async () => {
    const onChange = vi.fn();

    const leakedFilters = { sessionId: "abc", page: 3 } as unknown as Parameters<
      typeof UsageLogsFilters
    >[0]["filters"];

    const { container, unmount } = renderWithIntl(
      <UsageLogsFilters
        isAdmin={false}
        providers={[]}
        initialKeys={[]}
        // Runtime filters object may carry extra fields (e.g. page) even if TS types omit them
        filters={leakedFilters}
        onChange={onChange}
        onReset={() => {}}
      />
    );

    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "Apply Filter"
    );
    await actClick(applyBtn ?? null);

    expect(onChange).toHaveBeenCalledTimes(1);
    const calledFilters = onChange.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(calledFilters).toEqual(expect.objectContaining({ sessionId: "abc" }));
    expect(calledFilters && "page" in calledFilters).toBe(false);

    unmount();
  });
});
