import type { CurrencyCode } from "@/lib/utils/currency";

export interface UserQuotaSnapshot {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
}

export interface UserKeyWithUsage {
  id: number;
  name: string;
  status: "enabled" | "disabled";
  todayUsage: number;
  totalUsage: number;
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
}

export interface UserQuotaWithUsage {
  id: number;
  name: string;
  note?: string;
  role: "admin" | "user";
  providerGroup?: string | null;
  tags?: string[];
  quota: UserQuotaSnapshot | null;
  limit5hUsd: number | null;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  limitConcurrentSessions: number | null;
  totalUsage: number;
  keys: UserKeyWithUsage[];
}

export interface UsersQuotaClientProps {
  users: UserQuotaWithUsage[];
  currencyCode?: CurrencyCode;
  searchQuery?: string;
  sortBy?: "name" | "usage";
  filter?: "all" | "warning" | "exceeded";
}
