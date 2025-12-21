"use client";

import { addDays, format, parse } from "date-fns";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getKeys } from "@/actions/keys";
import { exportUsageLogs } from "@/actions/usage-logs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import type { UserDisplay } from "@/types/user";
import {
  useLazyEndpoints,
  useLazyModels,
  useLazyStatusCodes,
} from "../_hooks/use-lazy-filter-options";
import { LogsDateRangePicker } from "./logs-date-range-picker";

// 硬编码常用状态码（首次渲染时显示，无需等待加载）
const COMMON_STATUS_CODES: number[] = [200, 400, 401, 429, 500];

interface UsageLogsFiltersProps {
  isAdmin: boolean;
  users: UserDisplay[];
  providers: ProviderDisplay[];
  initialKeys: Key[];
  isUsersLoading?: boolean;
  isProvidersLoading?: boolean;
  isKeysLoading?: boolean;
  filters: {
    userId?: number;
    keyId?: number;
    providerId?: number;
    /** 开始时间戳（毫秒，浏览器本地时区的 00:00:00） */
    startTime?: number;
    /** 结束时间戳（毫秒，浏览器本地时区的次日 00:00:00，用于 < 比较） */
    endTime?: number;
    statusCode?: number;
    excludeStatusCode200?: boolean;
    model?: string;
    endpoint?: string;
    minRetryCount?: number;
  };
  onChange: (filters: UsageLogsFiltersProps["filters"]) => void;
  onReset: () => void;
}

export function UsageLogsFilters({
  isAdmin,
  users,
  providers,
  initialKeys,
  isUsersLoading = false,
  isProvidersLoading = false,
  isKeysLoading = false,
  filters,
  onChange,
  onReset,
}: UsageLogsFiltersProps) {
  const t = useTranslations("dashboard");

  // 惰性加载 hooks - 下拉展开时才加载数据
  const {
    data: models,
    isLoading: isModelsLoading,
    onOpenChange: onModelsOpenChange,
  } = useLazyModels();

  const {
    data: dynamicStatusCodes,
    isLoading: isStatusCodesLoading,
    onOpenChange: onStatusCodesOpenChange,
  } = useLazyStatusCodes();

  const {
    data: endpoints,
    isLoading: isEndpointsLoading,
    onOpenChange: onEndpointsOpenChange,
  } = useLazyEndpoints();

  // 合并硬编码和动态状态码（去重）
  const allStatusCodes = useMemo(() => {
    const dynamicOnly = dynamicStatusCodes.filter((code) => !COMMON_STATUS_CODES.includes(code));
    return dynamicOnly;
  }, [dynamicStatusCodes]);

  const [keys, setKeys] = useState<Key[]>(initialKeys);
  const [localFilters, setLocalFilters] = useState(filters);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (initialKeys.length > 0) {
      setKeys(initialKeys);
    }
  }, [initialKeys]);

  // 管理员用户首次加载时，如果 URL 中有 userId 参数，需要加载该用户的 keys
  // biome-ignore lint/correctness/useExhaustiveDependencies: 故意仅在组件挂载时执行一次
  useEffect(() => {
    const loadInitialKeys = async () => {
      if (isAdmin && filters.userId && initialKeys.length === 0) {
        try {
          const keysResult = await getKeys(filters.userId);
          if (keysResult.ok && keysResult.data) {
            setKeys(keysResult.data);
          }
        } catch (error) {
          console.error("Failed to load initial keys:", error);
        }
      }
    };
    loadInitialKeys();
  }, []);

  // 处理用户选择变更
  const handleUserChange = async (userId: string) => {
    const newUserId = userId ? parseInt(userId, 10) : undefined;
    const newFilters = { ...localFilters, userId: newUserId, keyId: undefined };
    setLocalFilters(newFilters);

    // 加载该用户的 keys
    if (newUserId) {
      try {
        const keysResult = await getKeys(newUserId);
        if (keysResult.ok && keysResult.data) {
          setKeys(keysResult.data);
        }
      } catch (error) {
        console.error("Failed to load keys:", error);
        toast.error(t("logs.error.loadKeysFailed"));
      }
    } else {
      setKeys([]);
    }
  };

  const handleApply = () => {
    onChange(localFilters);
  };

  const handleReset = () => {
    setLocalFilters({});
    setKeys([]);
    onReset();
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportUsageLogs(localFilters);
      if (!result.ok) {
        toast.error(result.error || t("logs.filters.exportError"));
        return;
      }

      // Create and download the file
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

  // Helper: convert timestamp to display date string (YYYY-MM-DD)
  const timestampToDateString = useCallback((timestamp: number): string => {
    const date = new Date(timestamp);
    return format(date, "yyyy-MM-dd");
  }, []);

  // Helper: parse date string to timestamp (start of day in browser timezone)
  const dateStringToTimestamp = useCallback((dateStr: string): number => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  }, []);

  // Memoized startDate for display (from timestamp)
  const displayStartDate = useMemo(() => {
    if (!localFilters.startTime) return undefined;
    return timestampToDateString(localFilters.startTime);
  }, [localFilters.startTime, timestampToDateString]);

  // Memoized endDate calculation: endTime is next day 00:00, subtract 1 day to show correct end date
  const displayEndDate = useMemo(() => {
    if (!localFilters.endTime) return undefined;
    // endTime is next day 00:00, so subtract 1 day to get actual end date
    const actualEndDate = new Date(localFilters.endTime - 24 * 60 * 60 * 1000);
    return format(actualEndDate, "yyyy-MM-dd");
  }, [localFilters.endTime]);

  // Memoized callback for date range changes
  const handleDateRangeChange = useCallback(
    (range: { startDate?: string; endDate?: string }) => {
      if (range.startDate && range.endDate) {
        // Convert to millisecond timestamps:
        // startTime: start of selected start date (00:00:00.000 in browser timezone)
        // endTime: start of day AFTER selected end date (for < comparison)
        const startTimestamp = dateStringToTimestamp(range.startDate);
        const endDate = parse(range.endDate, "yyyy-MM-dd", new Date());
        const nextDay = addDays(endDate, 1);
        const endTimestamp = new Date(
          nextDay.getFullYear(),
          nextDay.getMonth(),
          nextDay.getDate(),
          0,
          0,
          0,
          0
        ).getTime();
        setLocalFilters((prev) => ({
          ...prev,
          startTime: startTimestamp,
          endTime: endTimestamp,
        }));
      } else {
        setLocalFilters((prev) => ({
          ...prev,
          startTime: undefined,
          endTime: undefined,
        }));
      }
    },
    [dateStringToTimestamp]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* 时间范围 - 使用日期范围选择器 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.dateRange")}</Label>
          <LogsDateRangePicker
            startDate={displayStartDate}
            endDate={displayEndDate}
            onDateRangeChange={handleDateRangeChange}
          />
        </div>

        {/* 用户选择（仅 Admin） */}
        {isAdmin && (
          <div className="space-y-2 lg:col-span-4">
            <Label>{t("logs.filters.user")}</Label>
            <Select
              value={localFilters.userId?.toString() || ""}
              onValueChange={handleUserChange}
              disabled={isUsersLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isUsersLoading ? t("logs.stats.loading") : t("logs.filters.allUsers")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id.toString()}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Key 选择 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.apiKey")}</Label>
          <Select
            value={localFilters.keyId?.toString() || ""}
            onValueChange={(value: string) =>
              setLocalFilters({
                ...localFilters,
                keyId: value ? parseInt(value, 10) : undefined,
              })
            }
            disabled={isKeysLoading || (isAdmin && !localFilters.userId && keys.length === 0)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isKeysLoading
                    ? t("logs.stats.loading")
                    : isAdmin && !localFilters.userId && keys.length === 0
                      ? t("logs.filters.selectUserFirst")
                      : t("logs.filters.allKeys")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {keys.map((key) => (
                <SelectItem key={key.id} value={key.id.toString()}>
                  {key.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 供应商选择 */}
        {isAdmin && (
          <div className="space-y-2 lg:col-span-4">
            <Label>{t("logs.filters.provider")}</Label>
            <Select
              value={localFilters.providerId?.toString() || ""}
              onValueChange={(value: string) =>
                setLocalFilters({
                  ...localFilters,
                  providerId: value ? parseInt(value, 10) : undefined,
                })
              }
              disabled={isProvidersLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isProvidersLoading ? t("logs.stats.loading") : t("logs.filters.allProviders")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id.toString()}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 模型选择 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.model")}</Label>
          <Select
            value={localFilters.model || "all"}
            onValueChange={(value: string) =>
              setLocalFilters({ ...localFilters, model: value === "all" ? undefined : value })
            }
            onOpenChange={onModelsOpenChange}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isModelsLoading ? t("logs.stats.loading") : t("logs.filters.allModels")
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("logs.filters.allModels")}</SelectItem>
              {models.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
              {isModelsLoading && (
                <div className="p-2 text-center text-muted-foreground text-sm">
                  {t("logs.stats.loading")}
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Endpoint 选择 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.endpoint")}</Label>
          <Select
            value={localFilters.endpoint || "all"}
            onValueChange={(value: string) =>
              setLocalFilters({ ...localFilters, endpoint: value === "all" ? undefined : value })
            }
            onOpenChange={onEndpointsOpenChange}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isEndpointsLoading ? t("logs.stats.loading") : t("logs.filters.allEndpoints")
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("logs.filters.allEndpoints")}</SelectItem>
              {endpoints.map((endpoint) => (
                <SelectItem key={endpoint} value={endpoint}>
                  {endpoint}
                </SelectItem>
              ))}
              {isEndpointsLoading && (
                <div className="p-2 text-center text-muted-foreground text-sm">
                  {t("logs.stats.loading")}
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* 状态码选择 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.statusCode")}</Label>
          <Select
            value={
              localFilters.excludeStatusCode200 ? "!200" : localFilters.statusCode?.toString() || ""
            }
            onValueChange={(value: string) =>
              setLocalFilters({
                ...localFilters,
                statusCode: value && value !== "!200" ? parseInt(value, 10) : undefined,
                excludeStatusCode200: value === "!200",
              })
            }
            onOpenChange={onStatusCodesOpenChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("logs.filters.allStatusCodes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="!200">{t("logs.statusCodes.not200")}</SelectItem>
              <SelectItem value="200">{t("logs.statusCodes.200")}</SelectItem>
              <SelectItem value="400">{t("logs.statusCodes.400")}</SelectItem>
              <SelectItem value="401">{t("logs.statusCodes.401")}</SelectItem>
              <SelectItem value="429">{t("logs.statusCodes.429")}</SelectItem>
              <SelectItem value="500">{t("logs.statusCodes.500")}</SelectItem>
              {allStatusCodes.map((code) => (
                <SelectItem key={code} value={code.toString()}>
                  {code}
                </SelectItem>
              ))}
              {isStatusCodesLoading && (
                <div className="p-2 text-center text-muted-foreground text-sm">
                  {t("logs.stats.loading")}
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* 重试次数下限 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.minRetryCount")}</Label>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={localFilters.minRetryCount?.toString() ?? ""}
            placeholder={t("logs.filters.minRetryCountPlaceholder")}
            onChange={(e) =>
              setLocalFilters({
                ...localFilters,
                minRetryCount: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
          />
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
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
