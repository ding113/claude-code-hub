"use client";

import { useMemo, useState } from "react";
import { StatisticsChartCard } from "@/app/[locale]/dashboard/_components/bento/statistics-chart-card";
import type {
  ChartDataItem,
  StatisticsUser,
  TimeRange,
  UserStatisticsData,
} from "@/types/statistics";

function buildMockUsers(): StatisticsUser[] {
  return Array.from({ length: 8 }, (_, index) => {
    const id = index + 1;
    return { id, name: `u${id}`, dataKey: `user-${id}` };
  });
}

function gaussianSpike(x: number, center: number, width: number, height: number): number {
  const z = (x - center) / width;
  return Math.exp(-(z * z)) * height;
}

function buildMockChartData(timeRange: TimeRange, users: StatisticsUser[]): ChartDataItem[] {
  const now = new Date();

  if (timeRange === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    return Array.from({ length: 24 }, (_, hourIndex) => {
      const date = new Date(start.getTime() + hourIndex * 60 * 60 * 1000);
      const row: ChartDataItem = { date: date.toISOString() };

      users.forEach((user, userIndex) => {
        const base =
          gaussianSpike(hourIndex, 8, 1.2, 3.2) +
          gaussianSpike(hourIndex, 17, 0.9, 1.9) +
          gaussianSpike(hourIndex, 21, 0.8, 0.8);
        const scaled = Math.max(0, base * (1 / (1 + userIndex * 0.65)));
        const cost = Number(scaled.toFixed(6));
        const calls = Math.round(scaled * 12);

        row[`${user.dataKey}_cost`] = cost;
        row[`${user.dataKey}_calls`] = calls;
      });

      return row;
    });
  }

  const days = timeRange === "7days" ? 7 : timeRange === "30days" ? 30 : Math.max(1, now.getDate());
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  return Array.from({ length: days }, (_, dayIndex) => {
    const date = new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);
    const row: ChartDataItem = { date: dateStr };

    users.forEach((user, userIndex) => {
      const base =
        gaussianSpike(dayIndex, Math.floor(days * 0.35), Math.max(1, days * 0.08), 12) +
        gaussianSpike(dayIndex, Math.floor(days * 0.75), Math.max(1, days * 0.06), 7);
      const scaled = Math.max(0, base * (1 / (1 + userIndex * 0.6)));
      const cost = Number(scaled.toFixed(6));
      const calls = Math.round(scaled * 20);

      row[`${user.dataKey}_cost`] = cost;
      row[`${user.dataKey}_calls`] = calls;
    });

    return row;
  });
}

function buildMockStatistics(timeRange: TimeRange): UserStatisticsData {
  const users = buildMockUsers();
  const chartData = buildMockChartData(timeRange, users);
  const resolution = timeRange === "today" ? "hour" : "day";

  return {
    chartData,
    users,
    timeRange,
    resolution,
    mode: "users",
  };
}

export function StatisticsChartPreview() {
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const data = useMemo(() => buildMockStatistics(timeRange), [timeRange]);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <StatisticsChartCard data={data} onTimeRangeChange={setTimeRange} currencyCode="USD" />
    </div>
  );
}
