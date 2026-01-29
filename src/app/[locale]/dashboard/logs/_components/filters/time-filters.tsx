"use client";

import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
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
  serverTimeZone?: string;
}

export function TimeFilters({ filters, onFiltersChange, serverTimeZone }: TimeFiltersProps) {
  const t = useTranslations("dashboard.logs.filters");

  // Helper: convert timestamp to display date string (YYYY-MM-DD)
  const timestampToDateString = useCallback(
    (timestamp: number): string => {
      const date = new Date(timestamp);
      if (serverTimeZone) {
        return formatInTimeZone(date, serverTimeZone, "yyyy-MM-dd");
      }
      return format(date, "yyyy-MM-dd");
    },
    [serverTimeZone]
  );

  // Memoized startDate for display (from timestamp)
  const displayStartDate = useMemo(() => {
    if (!filters.startTime) return undefined;
    return timestampToDateString(filters.startTime);
  }, [filters.startTime, timestampToDateString]);

  const displayStartClock = useMemo(() => {
    if (!filters.startTime) return undefined;
    return formatClockFromTimestamp(filters.startTime, serverTimeZone);
  }, [filters.startTime, serverTimeZone]);

  // Memoized endDate calculation: endTime is exclusive, use endTime-1s to infer inclusive display end date
  const displayEndDate = useMemo(() => {
    if (!filters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
    const date = new Date(inclusiveEndTime);
    if (serverTimeZone) {
      return formatInTimeZone(date, serverTimeZone, "yyyy-MM-dd");
    }
    return format(date, "yyyy-MM-dd");
  }, [filters.endTime, serverTimeZone]);

  const displayEndClock = useMemo(() => {
    if (!filters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
    return formatClockFromTimestamp(inclusiveEndTime, serverTimeZone);
  }, [filters.endTime, serverTimeZone]);

  // Memoized callback for date range changes
  const handleDateRangeChange = useCallback(
    (range: { startDate?: string; endDate?: string }) => {
      if (range.startDate && range.endDate) {
        const startClock = displayStartClock ?? "00:00:00";
        const endClock = displayEndClock ?? "23:59:59";
        const startTimestamp = dateStringWithClockToTimestamp(
          range.startDate,
          startClock,
          serverTimeZone
        );
        const endInclusiveTimestamp = dateStringWithClockToTimestamp(
          range.endDate,
          endClock,
          serverTimeZone
        );
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
    [displayEndClock, displayStartClock, filters, onFiltersChange, serverTimeZone]
  );

  const handleStartTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextClock = e.target.value || "00:00:00";
      if (!filters.startTime) return;
      const dateStr = timestampToDateString(filters.startTime);
      const startTime = dateStringWithClockToTimestamp(dateStr, nextClock, serverTimeZone);
      if (startTime === undefined) return;
      onFiltersChange({
        ...filters,
        startTime,
      });
    },
    [filters, onFiltersChange, timestampToDateString, serverTimeZone]
  );

  const handleEndTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextClock = e.target.value || "23:59:59";
      if (!filters.endTime) return;
      const inclusiveEndTime = inclusiveEndTimestampFromExclusive(filters.endTime);
      const endDateStr = timestampToDateString(inclusiveEndTime);
      const endInclusiveTimestamp = dateStringWithClockToTimestamp(
        endDateStr,
        nextClock,
        serverTimeZone
      );
      if (endInclusiveTimestamp === undefined) return;
      onFiltersChange({
        ...filters,
        endTime: endInclusiveTimestamp + 1000,
      });
    },
    [filters, onFiltersChange, timestampToDateString, serverTimeZone]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>{t("dateRange")}</Label>
        <LogsDateRangePicker
          startDate={displayStartDate}
          endDate={displayEndDate}
          onDateRangeChange={handleDateRangeChange}
          serverTimeZone={serverTimeZone}
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
