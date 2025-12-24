"use client";
import { Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import { ProviderList } from "./provider-list";
import { ProviderSortDropdown, type SortKey } from "./provider-sort-dropdown";
import { ProviderTypeFilter } from "./provider-type-filter";

interface ProviderManagerProps {
  providers: ProviderDisplay[];
  currentUser?: User;
  healthStatus: Record<
    number,
    {
      circuitState: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailureTime: number | null;
      circuitOpenUntil: number | null;
      recoveryMinutes: number | null;
    }
  >;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
  loading?: boolean;
  refreshing?: boolean;
  addDialogSlot?: ReactNode;
}

export function ProviderManager({
  providers,
  currentUser,
  healthStatus,
  currencyCode = "USD",
  enableMultiProviderTypes,
  loading = false,
  refreshing = false,
  addDialogSlot,
}: ProviderManagerProps) {
  const t = useTranslations("settings.providers.search");
  const tFilter = useTranslations("settings.providers.filter");
  const tCommon = useTranslations("settings.common");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // Status and group filters
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [groupFilter, setGroupFilter] = useState<string[]>([]);

  // Extract unique groups from all providers
  const allGroups = useMemo(() => {
    const groups = new Set<string>();
    let hasDefaultGroup = false;
    providers.forEach((p) => {
      const tags = p.groupTag
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (!tags || tags.length === 0) {
        hasDefaultGroup = true;
      } else {
        tags.forEach((g) => groups.add(g));
      }
    });

    // Sort groups: "default" first, then alphabetically
    const sortedGroups = Array.from(groups).sort();
    if (hasDefaultGroup) {
      return ["default", ...sortedGroups];
    }
    return sortedGroups;
  }, [providers]);

  // 统一过滤逻辑：搜索 + 类型筛选 + 排序
  const filteredProviders = useMemo(() => {
    let result = providers;

    // 搜索过滤（name, url, groupTag - 支持匹配逗号分隔的单个标签）
    if (debouncedSearchTerm) {
      const term = debouncedSearchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.url.toLowerCase().includes(term) ||
          p.groupTag
            ?.split(",")
            .map((t) => t.trim().toLowerCase())
            .some((tag) => tag.includes(term))
      );
    }

    // 类型筛选
    if (typeFilter !== "all") {
      result = result.filter((p) => p.providerType === typeFilter);
    }

    // Filter by status
    if (statusFilter !== "all") {
      result = result.filter((p) => (statusFilter === "active" ? p.isEnabled : !p.isEnabled));
    }

    // Filter by groups
    if (groupFilter.length > 0) {
      result = result.filter((p) => {
        const providerGroups =
          p.groupTag
            ?.split(",")
            .map((t) => t.trim())
            .filter(Boolean) || [];

        // If provider has no groups and "default" is selected, include it
        if (providerGroups.length === 0 && groupFilter.includes("default")) {
          return true;
        }

        return groupFilter.some((g) => providerGroups.includes(g));
      });
    }

    // 排序
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "priority":
          // 优先级：数值越小越优先（1 > 2 > 3），升序排列
          return a.priority - b.priority;
        case "weight":
          // 权重：数值越大越优先，降序排列
          return b.weight - a.weight;
        case "actualPriority":
          // 实际选取顺序：先按优先级升序，再按权重降序
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          return b.weight - a.weight;
        case "createdAt": {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
            return b.createdAt.localeCompare(a.createdAt);
          }
          return timeB - timeA;
        }
        default:
          return 0;
      }
    });
  }, [providers, debouncedSearchTerm, typeFilter, sortBy, statusFilter, groupFilter]);

  return (
    <div className="space-y-4">
      {addDialogSlot ? <div className="flex justify-end">{addDialogSlot}</div> : null}
      {/* 筛选条件 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <ProviderTypeFilter value={typeFilter} onChange={setTypeFilter} disabled={loading} />

          {/* Status filter */}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
            disabled={loading}
          >
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tFilter("status.all")}</SelectItem>
              <SelectItem value="active">{tFilter("status.active")}</SelectItem>
              <SelectItem value="inactive">{tFilter("status.inactive")}</SelectItem>
            </SelectContent>
          </Select>

          <ProviderSortDropdown value={sortBy} onChange={setSortBy} disabled={loading} />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9"
              disabled={loading}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("clear")}
                disabled={loading}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Group filter */}
        {allGroups.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">{tFilter("groups.label")}</span>
            <Button
              variant={groupFilter.length === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupFilter([])}
              disabled={loading}
              className="h-7"
            >
              {tFilter("groups.all")}
            </Button>
            {allGroups.map((group) => (
              <Button
                key={group}
                variant={groupFilter.includes(group) ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setGroupFilter((prev) =>
                    prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]
                  );
                }}
                disabled={loading}
                className="h-7"
              >
                {group}
              </Button>
            ))}
          </div>
        )}
        {/* 搜索结果提示 */}
        {debouncedSearchTerm ? (
          <p className="text-sm text-muted-foreground">
            {loading
              ? tCommon("loading")
              : filteredProviders.length > 0
                ? t("found", { count: filteredProviders.length })
                : t("notFound")}
          </p>
        ) : (
          <div className="text-sm text-muted-foreground">
            {loading
              ? tCommon("loading")
              : t("showing", { filtered: filteredProviders.length, total: providers.length })}
          </div>
        )}
      </div>

      {/* 供应商列表 */}
      {loading && providers.length === 0 ? (
        <ProviderListSkeleton label={tCommon("loading")} />
      ) : (
        <div className="space-y-3">
          {refreshing ? <InlineLoading label={tCommon("loading")} /> : null}
          <ProviderList
            providers={filteredProviders}
            currentUser={currentUser}
            healthStatus={healthStatus}
            currencyCode={currencyCode}
            enableMultiProviderTypes={enableMultiProviderTypes}
          />
        </div>
      )}
    </div>
  );
}

export type { ProviderDisplay } from "@/types/provider";

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function ProviderListSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
      <InlineLoading label={label} />
    </div>
  );
}
