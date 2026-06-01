/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateRangePicker } from "@/app/[locale]/dashboard/leaderboard/_components/date-range-picker";
import type { DateRangeParams, LeaderboardPeriod } from "@/repository/leaderboard";

const tMock = vi.hoisted(() => {
  const messages: Record<string, string> = {
    "tabs.dailyRanking": "Daily",
    "tabs.weeklyRanking": "Weekly",
    "tabs.monthlyRanking": "Monthly",
    "tabs.allTimeRanking": "All Time",
    "dateRange.to": "to",
    "dateRange.prevPeriod": "Previous period",
    "dateRange.nextPeriod": "Next period",
  };

  return vi.fn((key: string) => messages[key] ?? key);
});

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useTranslations: () => tMock,
}));

function TestHarness({
  initialPeriod,
  initialDateRange,
}: {
  initialPeriod: LeaderboardPeriod;
  initialDateRange?: DateRangeParams;
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [dateRange, setDateRange] = useState<DateRangeParams | undefined>(initialDateRange);

  return (
    <DateRangePicker
      period={period}
      dateRange={dateRange}
      onPeriodChange={(nextPeriod, nextDateRange) => {
        setPeriod(nextPeriod);
        setDateRange(nextDateRange);
      }}
    />
  );
}

function getButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!button) {
    throw new Error(`Button with title "${title}" was not found`);
  }
  return button;
}

function expectDisplayedRange(container: HTMLElement, startDate: string, endDate: string) {
  expect(container.textContent).toContain(`${startDate} to ${endDate}`);
}

describe("Leaderboard DateRangePicker", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    vi.useRealTimers();
  });

  it("navigates monthly ranges by calendar month", async () => {
    await act(async () => {
      root!.render(<TestHarness initialPeriod="monthly" />);
    });

    expectDisplayedRange(container!, "2026-06-01", "2026-06-30");

    const previousButton = getButtonByTitle(container!, "Previous period");
    await act(async () => {
      previousButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expectDisplayedRange(container!, "2026-05-01", "2026-05-31");

    await act(async () => {
      previousButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expectDisplayedRange(container!, "2026-04-01", "2026-04-30");
  });

  it("keeps custom non-month ranges on fixed-width navigation", async () => {
    await act(async () => {
      root!.render(
        <TestHarness
          initialPeriod="custom"
          initialDateRange={{ startDate: "2026-06-10", endDate: "2026-06-19" }}
        />
      );
    });

    expectDisplayedRange(container!, "2026-06-10", "2026-06-19");

    await act(async () => {
      getButtonByTitle(container!, "Previous period").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expectDisplayedRange(container!, "2026-05-31", "2026-06-09");
  });
});
