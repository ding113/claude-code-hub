"use client";

import { addDays, differenceInCalendarDays, format, subDays } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface LogsDateRangePickerProps {
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  onDateRangeChange: (range: { startDate?: string; endDate?: string }) => void;
}

type QuickPeriod = "today" | "yesterday" | "last7days" | "last30days" | "custom";

const QUICK_PERIODS: Exclude<QuickPeriod, "custom">[] = [
  "today",
  "yesterday",
  "last7days",
  "last30days",
];

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function parseDate(dateStr: string): Date {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDateRangeForPeriod(period: QuickPeriod): { startDate: string; endDate: string } {
  const today = new Date();
  switch (period) {
    case "today":
      return { startDate: formatDate(today), endDate: formatDate(today) };
    case "yesterday": {
      const yesterday = subDays(today, 1);
      return { startDate: formatDate(yesterday), endDate: formatDate(yesterday) };
    }
    case "last7days":
      return { startDate: formatDate(subDays(today, 6)), endDate: formatDate(today) };
    case "last30days":
      return { startDate: formatDate(subDays(today, 29)), endDate: formatDate(today) };
    default:
      return { startDate: formatDate(today), endDate: formatDate(today) };
  }
}

function detectQuickPeriod(startDate?: string, endDate?: string): QuickPeriod | null {
  if (!startDate || !endDate) return null;

  for (const period of QUICK_PERIODS) {
    const range = getDateRangeForPeriod(period);
    if (range.startDate === startDate && range.endDate === endDate) {
      return period;
    }
  }
  return null;
}

function shiftDateRange(
  range: { startDate: string; endDate: string },
  direction: "prev" | "next"
): { startDate: string; endDate: string } {
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  // Use differenceInCalendarDays to avoid DST issues
  const days = differenceInCalendarDays(end, start) + 1;
  const shift = direction === "prev" ? -days : days;

  return {
    startDate: formatDate(addDays(start, shift)),
    endDate: formatDate(addDays(end, shift)),
  };
}

export function LogsDateRangePicker({
  startDate,
  endDate,
  onDateRangeChange,
}: LogsDateRangePickerProps) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const hasDateRange = Boolean(startDate && endDate);

  const activeQuickPeriod = useMemo(() => {
    return detectQuickPeriod(startDate, endDate);
  }, [startDate, endDate]);

  const selectedRange: DateRange | undefined = useMemo(() => {
    if (!startDate || !endDate) return undefined;
    return {
      from: parseDate(startDate),
      to: parseDate(endDate),
    };
  }, [startDate, endDate]);

  const handleQuickPeriodClick = useCallback(
    (period: QuickPeriod) => {
      const range = getDateRangeForPeriod(period);
      onDateRangeChange(range);
    },
    [onDateRangeChange]
  );

  const handleNavigate = useCallback(
    (direction: "prev" | "next") => {
      if (!startDate || !endDate) return;
      const newRange = shiftDateRange({ startDate, endDate }, direction);
      onDateRangeChange(newRange);
    },
    [startDate, endDate, onDateRangeChange]
  );

  const handleDateRangeSelect = useCallback(
    (range: DateRange | undefined) => {
      if (range?.from) {
        const newStartDate = formatDate(range.from);
        const newEndDate = range.to ? formatDate(range.to) : newStartDate;
        onDateRangeChange({ startDate: newStartDate, endDate: newEndDate });
        if (range.to) {
          setCalendarOpen(false);
        }
      }
    },
    [onDateRangeChange]
  );

  const handleClear = useCallback(() => {
    onDateRangeChange({ startDate: undefined, endDate: undefined });
    setCalendarOpen(false);
  }, [onDateRangeChange]);

  const displayDateRange = useMemo(() => {
    if (!startDate || !endDate) {
      return t("logs.filters.customRange");
    }
    if (startDate === endDate) {
      return startDate;
    }
    return `${startDate} ${t("leaderboard.dateRange.to")} ${endDate}`;
  }, [startDate, endDate, t]);

  const getQuickPeriodLabel = (period: QuickPeriod): string => {
    switch (period) {
      case "today":
        return tCommon("today");
      case "yesterday":
        return tCommon("yesterday");
      case "last7days":
        return t("logs.filters.last7days");
      case "last30days":
        return t("logs.filters.last30days");
      default:
        return "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick period buttons */}
      <div className="flex items-center gap-1">
        {QUICK_PERIODS.map((period) => (
          <Button
            key={period}
            variant={activeQuickPeriod === period ? "default" : "outline"}
            size="sm"
            onClick={() => handleQuickPeriodClick(period)}
            className="h-8"
            aria-pressed={activeQuickPeriod === period}
          >
            {getQuickPeriodLabel(period)}
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
          disabled={!hasDateRange}
          title={t("leaderboard.dateRange.prevPeriod")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={hasDateRange && !activeQuickPeriod ? "default" : "outline"}
              size="sm"
              className={cn(
                "min-w-[200px] justify-start text-left font-normal h-8",
                !hasDateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              <span className="truncate">{displayDateRange}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={selectedRange?.from}
              selected={selectedRange}
              onSelect={handleDateRangeSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
            {hasDateRange && (
              <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full" onClick={handleClear}>
                  {t("logs.filters.reset")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => handleNavigate("next")}
          disabled={!hasDateRange || (endDate !== undefined && endDate >= formatDate(new Date()))}
          title={t("leaderboard.dateRange.nextPeriod")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
