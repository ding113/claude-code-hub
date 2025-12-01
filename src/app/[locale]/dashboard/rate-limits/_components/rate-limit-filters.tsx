"use client";

import { format } from "date-fns";
import { Calendar, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { getProviders } from "@/actions/providers";
import { getUsers } from "@/actions/users";
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
import type { RateLimitEventFilters, RateLimitType } from "@/types/statistics";

export interface RateLimitFiltersProps {
  initialFilters: RateLimitEventFilters;
  onFiltersChange: (filters: RateLimitEventFilters) => void;
  disabled?: boolean;
}

const LIMIT_TYPES: RateLimitType[] = [
  "rpm",
  "usd_5h",
  "usd_weekly",
  "usd_monthly",
  "concurrent_sessions",
  "daily_quota",
];

/**
 * 限流事件过滤器组件
 * 包含日期范围、用户、供应商、限流类型选择器
 */
export function RateLimitFilters({
  initialFilters,
  onFiltersChange,
  disabled = false,
}: RateLimitFiltersProps) {
  const t = useTranslations("dashboard.rateLimits.filters");

  const [userId, setUserId] = React.useState<number | undefined>(initialFilters.user_id);
  const [providerId, setProviderId] = React.useState<number | undefined>(
    initialFilters.provider_id
  );
  const [limitType, setLimitType] = React.useState<RateLimitType | undefined>(
    initialFilters.limit_type
  );
  const [startTime, setStartTime] = React.useState<Date | undefined>(initialFilters.start_time);
  const [endTime, setEndTime] = React.useState<Date | undefined>(initialFilters.end_time);

  const [users, setUsers] = React.useState<Array<{ id: number; name: string }>>([]);
  const [providers, setProviders] = React.useState<Array<{ id: number; name: string }>>([]);
  const [loadingUsers, setLoadingUsers] = React.useState(true);
  const [loadingProviders, setLoadingProviders] = React.useState(true);

  // 加载用户列表
  React.useEffect(() => {
    getUsers().then((userList) => {
      setUsers(userList);
      setLoadingUsers(false);
    });
  }, []);

  // 加载供应商列表
  React.useEffect(() => {
    getProviders().then((providerList) => {
      setProviders(providerList);
      setLoadingProviders(false);
    });
  }, []);

  // 应用过滤器
  const handleApply = () => {
    const filters: RateLimitEventFilters = {
      user_id: userId,
      provider_id: providerId,
      limit_type: limitType,
      start_time: startTime,
      end_time: endTime,
    };
    onFiltersChange(filters);
  };

  // 重置过滤器
  const handleReset = () => {
    const defaultFilters: RateLimitEventFilters = {
      start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end_time: new Date(),
    };
    setUserId(undefined);
    setProviderId(undefined);
    setLimitType(undefined);
    setStartTime(defaultFilters.start_time);
    setEndTime(defaultFilters.end_time);
    onFiltersChange(defaultFilters);
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 日期范围选择 */}
        <div className="space-y-2">
          <Label htmlFor="start-time">
            <Calendar className="mr-1 inline h-4 w-4" />
            {t("startTime")}
          </Label>
          <Input
            id="start-time"
            type="datetime-local"
            value={startTime ? format(startTime, "yyyy-MM-dd'T'HH:mm") : ""}
            onChange={(e) => setStartTime(e.target.value ? new Date(e.target.value) : undefined)}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="end-time">
            <Calendar className="mr-1 inline h-4 w-4" />
            {t("endTime")}
          </Label>
          <Input
            id="end-time"
            type="datetime-local"
            value={endTime ? format(endTime, "yyyy-MM-dd'T'HH:mm") : ""}
            onChange={(e) => setEndTime(e.target.value ? new Date(e.target.value) : undefined)}
            disabled={disabled}
          />
        </div>

        {/* 用户选择器 */}
        <div className="space-y-2">
          <Label htmlFor="user-select">{t("user")}</Label>
          <Select
            value={userId?.toString() || "all"}
            onValueChange={(value) => setUserId(value === "all" ? undefined : Number(value))}
            disabled={disabled || loadingUsers}
          >
            <SelectTrigger id="user-select">
              <SelectValue placeholder={loadingUsers ? t("loading") : t("allUsers")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allUsers")}</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id.toString()}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 供应商选择器 */}
        <div className="space-y-2">
          <Label htmlFor="provider-select">{t("provider")}</Label>
          <Select
            value={providerId?.toString() || "all"}
            onValueChange={(value) => setProviderId(value === "all" ? undefined : Number(value))}
            disabled={disabled || loadingProviders}
          >
            <SelectTrigger id="provider-select">
              <SelectValue placeholder={loadingProviders ? t("loading") : t("allProviders")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allProviders")}</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id.toString()}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 限流类型选择器 */}
        <div className="space-y-2">
          <Label htmlFor="limit-type-select">{t("limitType")}</Label>
          <Select
            value={limitType || "all"}
            onValueChange={(value) =>
              setLimitType(value === "all" ? undefined : (value as RateLimitType))
            }
            disabled={disabled}
          >
            <SelectTrigger id="limit-type-select">
              <SelectValue placeholder={t("allLimitTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allLimitTypes")}</SelectItem>
              {LIMIT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`limitTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="mt-4 flex items-center gap-2">
        <Button onClick={handleApply} disabled={disabled} size="sm">
          {t("apply")}
        </Button>
        <Button onClick={handleReset} disabled={disabled} variant="outline" size="sm">
          <X className="mr-1 h-4 w-4" />
          {t("reset")}
        </Button>
      </div>
    </div>
  );
}
