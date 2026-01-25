"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dateStringWithClockToTimestamp,
  formatClockFromTimestamp,
  inclusiveEndTimestampFromExclusive,
} from "../../_utils/time-range";
import { LogsDateRangePicker } from "../logs-date-range-picker";
import type { UsageLogFilters } from "./types";

interface TimeFiltersProps {
  filters: UsageLogFilters;
  onFiltersChange: (filters: UsageLogFilters) => void;
}

export function TimeFilters({ filters, onFiltersChange }: TimeFiltersProps) {
  const t = useTranslations("dashboard.logs.filters");

  // Helper: convert timestamp to display date string (YYYY-MM-DD)
  const timestampToDateString = useCallback((timestamp: number): string => {
    const date = new Date(timestamp);
    return format(date, "yyyy-MM-dd");
  }, []);

  // Memoized startDate for display (from timestamp)
  const displayStartDate = useMemo(() => {
    if (!filters.startTime) return undefined;
    return timestampToDateString(filters.startTime);
  }, [filters.startTime, timestampToDateString]);

  const displayStartClock = useMemo(() => {
    if (!filters.startTime) return undefined;
    return formatClockFromTimestamp(filters.startTime);
  }, [filters.startTime]);

  // Memoized endDate calculation: endTime is exclusive, use endTime-1s to infer inclusive display end date
  const displayEndDate = useMemo(() => {
    if (!filters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
    return format(new Date(inclusiveEndTime), "yyyy-MM-dd");
  }, [filters.endTime]);

  const displayEndClock = useMemo(() => {
    if (!filters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
    return formatClockFromTimestamp(inclusiveEndTime);
  }, [filters.endTime]);

  // Memoized callback for date range changes
  const handleDateRangeChange = useCallback(
    (range: { startDate?: string; endDate?: string }) => {
      if (range.startDate && range.endDate) {
        const startClock = displayStartClock ?? "00:00:00";
        const endClock = displayEndClock ?? "23:59:59";
        const startTimestamp = dateStringWithClockToTimestamp(range.startDate, startClock);
        const endInclusiveTimestamp = dateStringWithClockToTimestamp(range.endDate, endClock);
        if (startTimestamp === undefined || endInclusiveTimestamp === undefined) {
          onFiltersChange({
            ...filters,
            startTime: undefined,
            endTime: undefined,
          });
          return;
        }
        const endTimestamp = endInclusiveTimestamp + 1000;
        onFiltersChange({
          ...filters,
          startTime: startTimestamp,
          endTime: endTimestamp,
        });
      } else {
        onFiltersChange({
          ...filters,
          startTime: undefined,
          endTime: undefined,
        });
      }
    },
    [displayEndClock, displayStartClock, filters, onFiltersChange]
  );

  const handleStartTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextClock = e.target.value || "00:00:00";
      if (!filters.startTime) return;
      const dateStr = timestampToDateString(filters.startTime);
      const startTime = dateStringWithClockToTimestamp(dateStr, nextClock);
      if (startTime === undefined) return;
      onFiltersChange({
        ...filters,
        startTime,
      });
    },
    [filters, onFiltersChange, timestampToDateString]
  );

  const handleEndTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextClock = e.target.value || "23:59:59";
      if (!filters.endTime) return;
      const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
      const endDateStr = timestampToDateString(inclusiveEndTime);
      const endInclusiveTimestamp = dateStringWithClockToTimestamp(endDateStr, nextClock);
      if (endInclusiveTimestamp === undefined) return;
      onFiltersChange({
        ...filters,
        endTime: endInclusiveTimestamp + 1000,
      });
    },
    [filters, onFiltersChange, timestampToDateString]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>{t("dateRange")}</Label>
        <LogsDateRangePicker
          startDate={displayStartDate}
          endDate={displayEndDate}
          onDateRangeChange={handleDateRangeChange}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("startTime")}</Label>
          <Input
            type="time"
            step={1}
            value={displayStartClock ?? ""}
            disabled={!displayStartDate}
            onChange={handleStartTimeChange}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("endTime")}</Label>
          <Input
            type="time"
            step={1}
            value={displayEndClock ?? ""}
            disabled={!displayEndDate}
            onChange={handleEndTimeChange}
          />
        </div>
      </div>
    </div>
  );
}
