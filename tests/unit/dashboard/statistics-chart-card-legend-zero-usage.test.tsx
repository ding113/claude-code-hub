import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { StatisticsChartCard } from "@/app/[locale]/dashboard/_components/bento/statistics-chart-card";
import type { UserStatisticsData } from "@/types/statistics";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("recharts", async () => {
  const React = await import("react");
  return {
    ResponsiveContainer: ({ children }: any) =>
      React.createElement("div", { "data-testid": "recharts-responsive" }, children),
    AreaChart: ({ children }: any) =>
      React.createElement("div", { "data-testid": "recharts-areachart" }, children),
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

function findButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes(text)
  );
}

describe("StatisticsChartCard legend", () => {
  test("shows users with zero usage so they can be toggled", async () => {
    const data: UserStatisticsData = {
      mode: "users",
      timeRange: "7days",
      resolution: "day",
      users: [
        { id: 1, name: "Alice", dataKey: "user-1" },
        { id: 2, name: "Bob", dataKey: "user-2" },
      ],
      chartData: [
        {
          date: "2026-01-26",
          "user-1_cost": "1.23",
          "user-1_calls": 5,
        },
      ],
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<StatisticsChartCard data={data} currencyCode="USD" />);
    });

    expect(findButtonByText(container, "Alice")).toBeTruthy();
    expect(findButtonByText(container, "Bob")).toBeTruthy();

    await act(async () => root.unmount());
    container.remove();
  });
});
