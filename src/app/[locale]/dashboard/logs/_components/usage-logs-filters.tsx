"use client";

import { format, startOfDay, startOfWeek } from "date-fns";
import { Clock, Download, Network, Server, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { exportUsageLogs } from "@/actions/usage-logs";
import { Button } from "@/components/ui/button";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import { ActiveFiltersDisplay } from "./filters/active-filters-display";
import { FilterSection } from "./filters/filter-section";
import { IdentityFilters } from "./filters/identity-filters";
import { type FilterPreset, QuickFiltersBar } from "./filters/quick-filters-bar";
import { RequestFilters } from "./filters/request-filters";
import { StatusFilters } from "./filters/status-filters";
import { TimeFilters } from "./filters/time-filters";
import type { UsageLogFilters } from "./filters/types";

// Valid keys for UsageLogFilters - strip any runtime-leaked fields like 'page'
const VALID_FILTER_KEYS: (keyof UsageLogFilters)[] = [
  "userId",
  "keyId",
  "providerId",
  "sessionId",
  "startTime",
  "endTime",
  "statusCode",
  "excludeStatusCode200",
  "model",
  "endpoint",
  "minRetryCount",
];

function sanitizeFilters(filters: UsageLogFilters): UsageLogFilters {
  const result: UsageLogFilters = {};
  for (const key of VALID_FILTER_KEYS) {
    if (filters[key] !== undefined) {
      (result as Record<string, unknown>)[key] = filters[key];
    }
  }
  return result;
}

interface UsageLogsFiltersProps {
  isAdmin: boolean;
  providers: ProviderDisplay[];
  initialKeys: Key[];
  isProvidersLoading?: boolean;
  isKeysLoading?: boolean;
  filters: UsageLogFilters;
  onChange: (filters: UsageLogFilters) => void;
  onReset: () => void;
}

export function UsageLogsFilters({
  isAdmin,
  providers,
  initialKeys,
  isProvidersLoading = false,
  isKeysLoading = false,
  filters,
  onChange,
  onReset,
}: UsageLogsFiltersProps) {
  const t = useTranslations("dashboard");

  const [localFilters, setLocalFilters] = useState<UsageLogFilters>(filters);
  const [isExporting, setIsExporting] = useState(false);
  const [activePreset, setActivePreset] = useState<FilterPreset | null>(null);

  // Track users and keys for display name resolution
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: number; name: string }>>([]);
  const [keys, setKeys] = useState<Key[]>(initialKeys);

  const userMap = useMemo(
    () => new Map(availableUsers.map((user) => [user.id, user.name])),
    [availableUsers]
  );

  const keyMap = useMemo(() => new Map(keys.map((key) => [key.id, key.name])), [keys]);

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers]
  );

  const displayNames = useMemo(
    () => ({
      getUserName: (id: number) => userMap.get(id),
      getKeyName: (id: number) => keyMap.get(id),
      getProviderName: (id: number) => providerMap.get(id),
    }),
    [userMap, keyMap, providerMap]
  );

  // Count active filters for each section
  const timeActiveCount = useMemo(() => {
    let count = 0;
    if (localFilters.startTime && localFilters.endTime) count++;
    return count;
  }, [localFilters.startTime, localFilters.endTime]);

  const identityActiveCount = useMemo(() => {
    let count = 0;
    if (isAdmin && localFilters.userId !== undefined) count++;
    if (localFilters.keyId !== undefined) count++;
    return count;
  }, [isAdmin, localFilters.userId, localFilters.keyId]);

  const requestActiveCount = useMemo(() => {
    let count = 0;
    if (isAdmin && localFilters.providerId !== undefined) count++;
    if (localFilters.model) count++;
    if (localFilters.endpoint) count++;
    if (localFilters.sessionId) count++;
    return count;
  }, [
    isAdmin,
    localFilters.providerId,
    localFilters.model,
    localFilters.endpoint,
    localFilters.sessionId,
  ]);

  const statusActiveCount = useMemo(() => {
    let count = 0;
    if (localFilters.statusCode !== undefined || localFilters.excludeStatusCode200) count++;
    if (localFilters.minRetryCount !== undefined && localFilters.minRetryCount > 0) count++;
    return count;
  }, [localFilters.statusCode, localFilters.excludeStatusCode200, localFilters.minRetryCount]);

  const handleApply = useCallback(() => {
    onChange(sanitizeFilters(localFilters));
  }, [localFilters, onChange]);

  const handleReset = useCallback(() => {
    setLocalFilters({});
    setKeys([]);
    setActivePreset(null);
    onReset();
  }, [onReset]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportUsageLogs(localFilters);
      if (!result.ok) {
        toast.error(result.error || t("logs.filters.exportError"));
        return;
      }

      const blob = new Blob([result.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `usage-logs-${format(new Date(), "yyyy-MM-dd-HHmmss")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(t("logs.filters.exportSuccess"));
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(t("logs.filters.exportError"));
    } finally {
      setIsExporting(false);
    }
  };

  const handlePresetToggle = useCallback(
    (preset: FilterPreset) => {
      const now = new Date();

      if (preset === activePreset) {
        // Toggle off - clear the preset-related filters
        setActivePreset(null);
        setLocalFilters((prev) => {
          const next = { ...prev };
          if (preset === "today" || preset === "this-week") {
            delete next.startTime;
            delete next.endTime;
          } else if (preset === "errors-only") {
            delete next.excludeStatusCode200;
          } else if (preset === "show-retries") {
            delete next.minRetryCount;
          }
          return next;
        });
        return;
      }

      setActivePreset(preset);

      if (preset === "today") {
        const todayStart = startOfDay(now).getTime();
        const todayEnd = todayStart + 24 * 60 * 60 * 1000;
        setLocalFilters((prev) => ({
          ...prev,
          startTime: todayStart,
          endTime: todayEnd,
        }));
      } else if (preset === "this-week") {
        const weekStart = startOfWeek(now, { weekStartsOn: 1 }).getTime();
        const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
        setLocalFilters((prev) => ({
          ...prev,
          startTime: weekStart,
          endTime: weekEnd,
        }));
      } else if (preset === "errors-only") {
        setLocalFilters((prev) => ({
          ...prev,
          excludeStatusCode200: true,
          statusCode: undefined,
        }));
      } else if (preset === "show-retries") {
        setLocalFilters((prev) => ({
          ...prev,
          minRetryCount: 1,
        }));
      }
    },
    [activePreset]
  );

  const handleRemoveFilter = useCallback((key: keyof UsageLogFilters) => {
    setLocalFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActivePreset(null);
  }, []);

  return (
    <div className="space-y-4">
      {/* Quick Filters Bar */}
      <QuickFiltersBar activePreset={activePreset} onPresetToggle={handlePresetToggle} />

      {/* Active Filters Display */}
      <ActiveFiltersDisplay
        filters={localFilters}
        onRemove={handleRemoveFilter}
        onClearAll={handleReset}
        displayNames={displayNames}
        isAdmin={isAdmin}
      />

      {/* Filter Sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Time Range Section */}
        <FilterSection
          title={t("logs.filters.groups.time")}
          description={t("logs.filters.groups.timeDesc")}
          icon={Clock}
          activeCount={timeActiveCount}
          defaultOpen={true}
        >
          <TimeFilters filters={localFilters} onFiltersChange={setLocalFilters} />
        </FilterSection>

        {/* Identity Section (Admin only for User, all for Key) */}
        <FilterSection
          title={t("logs.filters.groups.identity")}
          description={t("logs.filters.groups.identityDesc")}
          icon={User}
          activeCount={identityActiveCount}
          defaultOpen={true}
        >
          <IdentityFilters
            isAdmin={isAdmin}
            filters={localFilters}
            onFiltersChange={setLocalFilters}
            initialKeys={initialKeys}
            isKeysLoading={isKeysLoading}
            onKeysChange={setKeys}
            onUsersChange={setAvailableUsers}
          />
        </FilterSection>

        {/* Request Section */}
        <FilterSection
          title={t("logs.filters.groups.request")}
          description={t("logs.filters.groups.requestDesc")}
          icon={Network}
          activeCount={requestActiveCount}
          defaultOpen={false}
        >
          <RequestFilters
            isAdmin={isAdmin}
            filters={localFilters}
            onFiltersChange={setLocalFilters}
            providers={providers}
            isProvidersLoading={isProvidersLoading}
          />
        </FilterSection>

        {/* Status Section */}
        <FilterSection
          title={t("logs.filters.groups.status")}
          description={t("logs.filters.groups.statusDesc")}
          icon={Server}
          activeCount={statusActiveCount}
          defaultOpen={false}
        >
          <StatusFilters filters={localFilters} onFiltersChange={setLocalFilters} />
        </FilterSection>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button onClick={handleApply}>{t("logs.filters.apply")}</Button>
        <Button variant="outline" onClick={handleReset}>
          {t("logs.filters.reset")}
        </Button>
        <Button variant="outline" onClick={handleExport} disabled={isExporting}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {isExporting ? t("logs.filters.exporting") : t("logs.filters.export")}
        </Button>
      </div>
    </div>
  );
}
