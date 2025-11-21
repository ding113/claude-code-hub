"use client";

import { useState, useMemo } from "react";
import { KeysQuotaClient } from "./keys-quota-client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import type { CurrencyCode } from "@/lib/utils/currency";
import { hasKeyQuotaSet, isWarning, isExceeded } from "@/lib/utils/quota-helpers";
import { useTranslations } from "next-intl";

interface KeyQuota {
  cost5h: { current: number; limit: number | null };
  costDaily: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
}

interface UserQuota {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
}

interface KeyWithQuota {
  id: number;
  name: string;
  isEnabled: boolean;
  expiresAt: string | null;
  quota: KeyQuota | null;
  limitDailyUsd: number | null;
  dailyResetTime: string;
  dailyResetMode: "fixed" | "rolling";
}

interface UserWithKeys {
  id: number;
  name: string;
  role: string;
  userQuota: UserQuota | null;
  keys: KeyWithQuota[];
}

interface KeysQuotaManagerProps {
  users: UserWithKeys[];
  currencyCode?: CurrencyCode;
}

export function KeysQuotaManager({ users, currencyCode = "USD" }: KeysQuotaManagerProps) {
  const t = useTranslations("quota.keys");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<
    "all" | "key-quota" | "user-quota-only" | "warning" | "exceeded"
  >("all");

  // 搜索 + 筛选逻辑
  const filteredUsers = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase();

    return users
      .map((user) => {
        // 搜索：用户名或密钥名匹配
        let filteredKeys = user.keys;
        if (searchQuery) {
          const userNameMatches = user.name.toLowerCase().includes(lowerQuery);
          if (!userNameMatches) {
            filteredKeys = filteredKeys.filter((key) =>
              key.name.toLowerCase().includes(lowerQuery)
            );
          }
        }

        // 筛选：根据限额类型或状态
        switch (filter) {
          case "key-quota":
            // 仅显示设置了密钥限额的
            filteredKeys = filteredKeys.filter((key) => hasKeyQuotaSet(key.quota));
            break;
          case "user-quota-only":
            // 仅显示继承用户限额的（未设置密钥限额）
            filteredKeys = filteredKeys.filter((key) => !hasKeyQuotaSet(key.quota));
            break;
          case "warning":
            // 预警：密钥或用户使用率 ≥60%
            filteredKeys = filteredKeys.filter((key) => isWarning(key.quota, user.userQuota));
            break;
          case "exceeded":
            // 超限：密钥或用户使用率 ≥100%
            filteredKeys = filteredKeys.filter((key) => isExceeded(key.quota, user.userQuota));
            break;
        }

        return { ...user, keys: filteredKeys };
      })
      .filter((user) => user.keys.length > 0); // 过滤掉没有密钥的用户
  }, [users, searchQuery, filter]);

  // 统计信息
  const totalFilteredKeys = filteredUsers.reduce((sum, user) => sum + user.keys.length, 0);
  const totalFilteredUsers = filteredUsers.length;

  return (
    <div className="space-y-4">
      {/* 搜索框 + 筛选器 */}
      <div className="flex items-center gap-4">
        {/* 搜索框 */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 筛选器 */}
        <Select value={filter} onValueChange={(value: typeof filter) => setFilter(value)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("filterLabel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter.all")}</SelectItem>
            <SelectItem value="key-quota">{t("filter.keyQuota")}</SelectItem>
            <SelectItem value="user-quota-only">{t("filter.userQuotaOnly")}</SelectItem>
            <SelectItem value="warning">{t("filter.warning")}</SelectItem>
            <SelectItem value="exceeded">{t("filter.exceeded")}</SelectItem>
          </SelectContent>
        </Select>

        {/* 统计信息 */}
        <div className="text-sm text-muted-foreground ml-auto">
          {t("filterCount", { users: totalFilteredUsers, keys: totalFilteredKeys })}
        </div>
      </div>

      {/* 按用户分组的密钥列表 */}
      <KeysQuotaClient users={filteredUsers} currencyCode={currencyCode} />
    </div>
  );
}
