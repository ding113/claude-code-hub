"use client";

import { format } from "date-fns";
import { Check, ChevronsUpDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getKeys } from "@/actions/keys";
import { exportUsageLogs, getUsageLogSessionIdSuggestions } from "@/actions/usage-logs";
import { searchUsersForFilter } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";
import {
  useLazyEndpoints,
  useLazyModels,
  useLazyStatusCodes,
} from "../_hooks/use-lazy-filter-options";
import {
  dateStringWithClockToTimestamp,
  formatClockFromTimestamp,
  inclusiveEndTimestampFromExclusive,
} from "../_utils/time-range";
import { LogsDateRangePicker } from "./logs-date-range-picker";

// 硬编码常用状态码（首次渲染时显示，无需等待加载）
const COMMON_STATUS_CODES: number[] = [200, 400, 401, 429, 500];
const SESSION_ID_SUGGESTION_MIN_LEN = 2;

interface UsageLogsFiltersProps {
  isAdmin: boolean;
  providers: ProviderDisplay[];
  initialKeys: Key[];
  isProvidersLoading?: boolean;
  isKeysLoading?: boolean;
  filters: {
    userId?: number;
    keyId?: number;
    providerId?: number;
    sessionId?: string;
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
  providers,
  initialKeys,
  isProvidersLoading = false,
  isKeysLoading = false,
  filters,
  onChange,
  onReset,
}: UsageLogsFiltersProps) {
  const t = useTranslations("dashboard");

  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: number; name: string }>>([]);
  const userSearchRequestIdRef = useRef(0);
  const lastLoadedUserSearchTermRef = useRef<string | undefined>(undefined);
  const isMountedRef = useRef(true);

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

  const userMap = useMemo(
    () => new Map(availableUsers.map((user) => [user.id, user.name])),
    [availableUsers]
  );

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers]
  );

  const [keys, setKeys] = useState<Key[]>(initialKeys);
  const [localFilters, setLocalFilters] = useState(filters);
  const [isExporting, setIsExporting] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [providerPopoverOpen, setProviderPopoverOpen] = useState(false);
  const [sessionIdPopoverOpen, setSessionIdPopoverOpen] = useState(false);
  const [isSessionIdsLoading, setIsSessionIdsLoading] = useState(false);
  const [availableSessionIds, setAvailableSessionIds] = useState<string[]>([]);
  const debouncedSessionIdSearchTerm = useDebounce(localFilters.sessionId ?? "", 300);
  const sessionIdSearchRequestIdRef = useRef(0);
  const lastLoadedSessionIdSearchTermRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadUsersForFilter = useCallback(async (term?: string) => {
    const requestId = ++userSearchRequestIdRef.current;
    setIsUsersLoading(true);
    lastLoadedUserSearchTermRef.current = term;

    try {
      const result = await searchUsersForFilter(term);
      if (!isMountedRef.current || requestId !== userSearchRequestIdRef.current) return;

      if (result.ok) {
        setAvailableUsers(result.data);
      } else {
        console.error("Failed to load users for filter:", result.error);
        setAvailableUsers([]);
      }
    } catch (error) {
      if (!isMountedRef.current || requestId !== userSearchRequestIdRef.current) return;

      console.error("Failed to load users for filter:", error);
      setAvailableUsers([]);
    } finally {
      if (isMountedRef.current && requestId === userSearchRequestIdRef.current) {
        setIsUsersLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsersForFilter(undefined);
  }, [isAdmin, loadUsersForFilter]);

  useEffect(() => {
    if (!isAdmin || !userPopoverOpen) return;

    const term = debouncedUserSearchTerm.trim() || undefined;
    if (term === lastLoadedUserSearchTermRef.current) return;

    void loadUsersForFilter(term);
  }, [isAdmin, userPopoverOpen, debouncedUserSearchTerm, loadUsersForFilter]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!userPopoverOpen) {
      setUserSearchTerm("");
    }
  }, [isAdmin, userPopoverOpen]);

  const loadSessionIdsForFilter = useCallback(
    async (term: string) => {
      const requestId = ++sessionIdSearchRequestIdRef.current;
      setIsSessionIdsLoading(true);
      lastLoadedSessionIdSearchTermRef.current = term;

      try {
        const result = await getUsageLogSessionIdSuggestions({
          term,
          userId: isAdmin ? localFilters.userId : undefined,
          keyId: localFilters.keyId,
          providerId: localFilters.providerId,
        });

        if (!isMountedRef.current || requestId !== sessionIdSearchRequestIdRef.current) return;

        if (result.ok) {
          setAvailableSessionIds(result.data);
        } else {
          console.error("Failed to load sessionId suggestions:", result.error);
          setAvailableSessionIds([]);
        }
      } catch (error) {
        if (!isMountedRef.current || requestId !== sessionIdSearchRequestIdRef.current) return;
        console.error("Failed to load sessionId suggestions:", error);
        setAvailableSessionIds([]);
      } finally {
        if (isMountedRef.current && requestId === sessionIdSearchRequestIdRef.current) {
          setIsSessionIdsLoading(false);
        }
      }
    },
    [isAdmin, localFilters.keyId, localFilters.providerId, localFilters.userId]
  );

  useEffect(() => {
    if (!sessionIdPopoverOpen) return;

    const term = debouncedSessionIdSearchTerm.trim();
    if (term.length < SESSION_ID_SUGGESTION_MIN_LEN) {
      setAvailableSessionIds([]);
      lastLoadedSessionIdSearchTermRef.current = undefined;
      return;
    }

    if (term === lastLoadedSessionIdSearchTermRef.current) return;
    void loadSessionIdsForFilter(term);
  }, [sessionIdPopoverOpen, debouncedSessionIdSearchTerm, loadSessionIdsForFilter]);

  useEffect(() => {
    if (!sessionIdPopoverOpen) {
      setAvailableSessionIds([]);
      lastLoadedSessionIdSearchTermRef.current = undefined;
    }
  }, [sessionIdPopoverOpen]);

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

  // Memoized startDate for display (from timestamp)
  const displayStartDate = useMemo(() => {
    if (!localFilters.startTime) return undefined;
    return timestampToDateString(localFilters.startTime);
  }, [localFilters.startTime, timestampToDateString]);

  const displayStartClock = useMemo(() => {
    if (!localFilters.startTime) return undefined;
    return formatClockFromTimestamp(localFilters.startTime);
  }, [localFilters.startTime]);

  // Memoized endDate calculation: endTime is exclusive, use endTime-1s to infer inclusive display end date
  const displayEndDate = useMemo(() => {
    if (!localFilters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(localFilters.endTime);
    return format(new Date(inclusiveEndTime), "yyyy-MM-dd");
  }, [localFilters.endTime]);

  const displayEndClock = useMemo(() => {
    if (!localFilters.endTime) return undefined;
    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(localFilters.endTime);
    return formatClockFromTimestamp(inclusiveEndTime);
  }, [localFilters.endTime]);

  // Memoized callback for date range changes
  const handleDateRangeChange = useCallback(
    (range: { startDate?: string; endDate?: string }) => {
      if (range.startDate && range.endDate) {
        // Convert to millisecond timestamps:
        // startTime: startDate + startClock (default 00:00:00)
        // endTime: endDate + endClock as exclusive upper bound (endClock default 23:59:59)
        const startClock = displayStartClock ?? "00:00:00";
        const endClock = displayEndClock ?? "23:59:59";
        const startTimestamp = dateStringWithClockToTimestamp(range.startDate, startClock);
        const endInclusiveTimestamp = dateStringWithClockToTimestamp(range.endDate, endClock);
        const endTimestamp = endInclusiveTimestamp + 1000;
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
    [displayEndClock, displayStartClock]
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("logs.filters.startTime")}</Label>
              <Input
                type="time"
                step={1}
                value={displayStartClock ?? ""}
                disabled={!displayStartDate}
                onChange={(e) => {
                  const nextClock = e.target.value || "00:00:00";
                  setLocalFilters((prev) => {
                    if (!prev.startTime) return prev;
                    const dateStr = timestampToDateString(prev.startTime);
                    return {
                      ...prev,
                      startTime: dateStringWithClockToTimestamp(dateStr, nextClock),
                    };
                  });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("logs.filters.endTime")}</Label>
              <Input
                type="time"
                step={1}
                value={displayEndClock ?? ""}
                disabled={!displayEndDate}
                onChange={(e) => {
                  const nextClock = e.target.value || "23:59:59";
                  setLocalFilters((prev) => {
                    if (!prev.endTime) return prev;
                    const inclusiveEndTime = inclusiveEndTimestampFromExclusive(prev.endTime);
                    const endDateStr = timestampToDateString(inclusiveEndTime);
                    const endInclusiveTimestamp = dateStringWithClockToTimestamp(
                      endDateStr,
                      nextClock
                    );
                    return {
                      ...prev,
                      endTime: endInclusiveTimestamp + 1000,
                    };
                  });
                }}
              />
            </div>
          </div>
        </div>

        {/* 用户选择（仅 Admin） */}
        {isAdmin && (
          <div className="space-y-2 lg:col-span-4">
            <Label>{t("logs.filters.user")}</Label>
            <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={userPopoverOpen}
                  type="button"
                  className="w-full justify-between"
                >
                  {localFilters.userId ? (
                    (userMap.get(localFilters.userId) ?? localFilters.userId.toString())
                  ) : (
                    <span className="text-muted-foreground">
                      {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.allUsers")}
                    </span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[320px] p-0"
                align="start"
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={t("logs.filters.searchUser")}
                    value={userSearchTerm}
                    onValueChange={(value) => setUserSearchTerm(value)}
                  />
                  <CommandList className="max-h-[250px] overflow-y-auto">
                    <CommandEmpty>
                      {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.noUserFound")}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value={t("logs.filters.allUsers")}
                        onSelect={() => {
                          void handleUserChange("");
                          setUserPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1">{t("logs.filters.allUsers")}</span>
                        {!localFilters.userId && <Check className="h-4 w-4 text-primary" />}
                      </CommandItem>
                      {availableUsers.map((user) => (
                        <CommandItem
                          key={user.id}
                          value={user.name}
                          onSelect={() => {
                            void handleUserChange(user.id.toString());
                            setUserPopoverOpen(false);
                          }}
                          className="cursor-pointer"
                        >
                          <span className="flex-1">{user.name}</span>
                          {localFilters.userId === user.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
            <Popover open={providerPopoverOpen} onOpenChange={setProviderPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={providerPopoverOpen}
                  disabled={isProvidersLoading}
                  type="button"
                  className="w-full justify-between"
                >
                  {localFilters.providerId ? (
                    (providerMap.get(localFilters.providerId) ?? localFilters.providerId.toString())
                  ) : (
                    <span className="text-muted-foreground">
                      {isProvidersLoading
                        ? t("logs.stats.loading")
                        : t("logs.filters.allProviders")}
                    </span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[320px] p-0"
                align="start"
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
              >
                <Command shouldFilter={true}>
                  <CommandInput placeholder={t("logs.filters.searchProvider")} />
                  <CommandList className="max-h-[250px] overflow-y-auto">
                    <CommandEmpty>
                      {isProvidersLoading
                        ? t("logs.stats.loading")
                        : t("logs.filters.noProviderFound")}
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value={t("logs.filters.allProviders")}
                        onSelect={() => {
                          setLocalFilters({
                            ...localFilters,
                            providerId: undefined,
                          });
                          setProviderPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1">{t("logs.filters.allProviders")}</span>
                        {!localFilters.providerId && <Check className="h-4 w-4 text-primary" />}
                      </CommandItem>
                      {providers.map((provider) => (
                        <CommandItem
                          key={provider.id}
                          value={provider.name}
                          onSelect={() => {
                            setLocalFilters({
                              ...localFilters,
                              providerId: provider.id,
                            });
                            setProviderPopoverOpen(false);
                          }}
                          className="cursor-pointer"
                        >
                          <span className="flex-1">{provider.name}</span>
                          {localFilters.providerId === provider.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Session ID 联想 */}
        <div className="space-y-2 lg:col-span-4">
          <Label>{t("logs.filters.sessionId")}</Label>
          <Popover open={sessionIdPopoverOpen} onOpenChange={setSessionIdPopoverOpen}>
            <PopoverAnchor asChild>
              <Input
                value={localFilters.sessionId ?? ""}
                placeholder={t("logs.filters.searchSessionId")}
                onFocus={() => {
                  const term = (localFilters.sessionId ?? "").trim();
                  setSessionIdPopoverOpen(term.length >= SESSION_ID_SUGGESTION_MIN_LEN);
                }}
                onChange={(e) => {
                  const next = e.target.value.trim();
                  setLocalFilters((prev) => ({ ...prev, sessionId: next || undefined }));
                  setSessionIdPopoverOpen(next.length >= SESSION_ID_SUGGESTION_MIN_LEN);
                }}
              />
            </PopoverAnchor>
            <PopoverContent
              className="w-[320px] p-0"
              align="start"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <Command shouldFilter={false}>
                <CommandList className="max-h-[250px] overflow-y-auto">
                  <CommandEmpty>
                    {isSessionIdsLoading
                      ? t("logs.stats.loading")
                      : t("logs.filters.noSessionFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    {availableSessionIds.map((sessionId) => (
                      <CommandItem
                        key={sessionId}
                        value={sessionId}
                        onSelect={() => {
                          setLocalFilters((prev) => ({ ...prev, sessionId }));
                          setSessionIdPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1 font-mono text-xs truncate">{sessionId}</span>
                        {localFilters.sessionId === sessionId && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

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
