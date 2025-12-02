"use client";

import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LeaderboardPeriod } from "@/repository/leaderboard";

interface DateRangePickerProps {
  period: LeaderboardPeriod;
  dateRange?: { startDate: string; endDate: string };
  onPeriodChange: (
    period: LeaderboardPeriod,
    dateRange?: { startDate: string; endDate: string }
  ) => void;
}

type QuickPeriod = "daily" | "weekly" | "monthly" | "allTime";

const QUICK_PERIODS: QuickPeriod[] = ["daily", "weekly", "monthly", "allTime"];

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function parseDate(dateStr: string): Date {
  // Parse as local date to avoid timezone issues
  // new Date("YYYY-MM-DD") parses as UTC, which causes off-by-one errors in different timezones
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDateRangeForPeriod(
  period: QuickPeriod,
  baseDate: Date = new Date()
): { startDate: string; endDate: string } {
  switch (period) {
    case "daily":
      return { startDate: formatDate(baseDate), endDate: formatDate(baseDate) };
    case "weekly": {
      const start = startOfWeek(baseDate, { weekStartsOn: 1 });
      const end = endOfWeek(baseDate, { weekStartsOn: 1 });
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    case "monthly": {
      const start = startOfMonth(baseDate);
      const end = endOfMonth(baseDate);
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }
    default:
      return { startDate: "2020-01-01", endDate: formatDate(new Date()) };
  }
}

function shiftDateRange(
  range: { startDate: string; endDate: string },
  direction: "prev" | "next"
): { startDate: string; endDate: string } {
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const shift = direction === "prev" ? -days : days;

  return {
    startDate: formatDate(addDays(start, shift)),
    endDate: formatDate(addDays(end, shift)),
  };
}

export function DateRangePicker({ period, dateRange, onPeriodChange }: DateRangePickerProps) {
  const t = useTranslations("dashboard.leaderboard");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const currentRange = useMemo(() => {
    if (period === "custom" && dateRange) {
      return dateRange;
    }
    if (period !== "custom" && QUICK_PERIODS.includes(period as QuickPeriod)) {
      return getDateRangeForPeriod(period as QuickPeriod);
    }
    return getDateRangeForPeriod("daily");
  }, [period, dateRange]);

  const selectedRange: DateRange = useMemo(() => {
    return {
      from: parseDate(currentRange.startDate),
      to: parseDate(currentRange.endDate),
    };
  }, [currentRange]);

  const handleQuickPeriodClick = useCallback(
    (quickPeriod: QuickPeriod) => {
      if (quickPeriod === "allTime") {
        onPeriodChange("allTime");
      } else {
        onPeriodChange(quickPeriod);
      }
    },
    [onPeriodChange]
  );

  const handleNavigate = useCallback(
    (direction: "prev" | "next") => {
      const newRange = shiftDateRange(currentRange, direction);
      onPeriodChange("custom", newRange);
    },
    [currentRange, onPeriodChange]
  );

  const handleDateRangeSelect = useCallback(
    (range: DateRange | undefined) => {
      if (range?.from) {
        const startDate = formatDate(range.from);
        const endDate = range.to ? formatDate(range.to) : startDate;
        onPeriodChange("custom", { startDate, endDate });
        if (range.to) {
          setCalendarOpen(false);
        }
      }
    },
    [onPeriodChange]
  );

  const displayDateRange = useMemo(() => {
    if (period === "allTime") {
      return t("tabs.allTimeRanking");
    }
    const start = currentRange.startDate;
    const end = currentRange.endDate;
    if (start === end) {
      return start;
    }
    return `${start} ${t("dateRange.to")} ${end}`;
  }, [period, currentRange, t]);

  const isQuickPeriodActive = (quickPeriod: QuickPeriod) => {
    if (period === "custom") return false;
    return period === quickPeriod;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick period buttons */}
      <div className="flex items-center gap-1">
        {QUICK_PERIODS.map((qp) => (
          <Button
            key={qp}
            variant={isQuickPeriodActive(qp) ? "default" : "outline"}
            size="sm"
            onClick={() => handleQuickPeriodClick(qp)}
            className="h-8"
          >
            {t(
              `tabs.${qp === "daily" ? "dailyRanking" : qp === "weekly" ? "weeklyRanking" : qp === "monthly" ? "monthlyRanking" : "allTimeRanking"}`
            )}
          </Button>
        ))}
      </div>

      {/* Separator */}
      <div className="h-6 w-px bg-border mx-1" />

      {/* Navigation and date display */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => handleNavigate("prev")}
          disabled={period === "allTime"}
          title={t("dateRange.prevPeriod")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={period === "custom" ? "default" : "outline"}
              size="sm"
              className={cn(
                "min-w-[200px] justify-start text-left font-normal h-8",
                period !== "custom" && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              <span className="truncate">{displayDateRange}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={selectedRange.from}
              selected={selectedRange}
              onSelect={handleDateRangeSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => handleNavigate("next")}
          disabled={period === "allTime" || currentRange.endDate >= formatDate(new Date())}
          title={t("dateRange.nextPeriod")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
