"use client";
import { AlertTriangle, Filter, LayoutGrid, LayoutList, Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap, ProviderType } from "@/types/provider";
import type { User } from "@/types/user";
import {
  type BatchActionMode,
  ProviderBatchActions,
  ProviderBatchDialog,
  ProviderBatchToolbar,
} from "./batch-edit";
import { ProviderList } from "./provider-list";
import { ProviderSortDropdown, type SortKey } from "./provider-sort-dropdown";
import { ProviderTypeFilter } from "./provider-type-filter";
import { ProviderVendorView } from "./provider-vendor-view";

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
  statistics?: ProviderStatisticsMap;
  statisticsLoading?: boolean;
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
  statistics = {},
  statisticsLoading = false,
  currencyCode = "USD",
  enableMultiProviderTypes,
  loading = false,
  refreshing = false,
  addDialogSlot,
}: ProviderManagerProps) {
  const t = useTranslations("settings.providers.search");
  const tStrings = useTranslations("settings.providers");
  const tFilter = useTranslations("settings.providers.filter");
  const tCommon = useTranslations("settings.common");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("priority");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "vendor">("list");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  // Status and group filters
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [circuitBrokenFilter, setCircuitBrokenFilter] = useState(false);

  // Mobile filter sheet state
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Batch edit state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<number>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchActionMode, setBatchActionMode] = useState<BatchActionMode>(null);

  // Count providers with circuit breaker open
  const circuitBrokenCount = useMemo(() => {
    return providers.filter((p) => healthStatus[p.id]?.circuitState === "open").length;
  }, [providers, healthStatus]);

  // Auto-reset circuit broken filter when no providers are broken
  useEffect(() => {
    if (circuitBrokenCount === 0 && circuitBrokenFilter) {
      setCircuitBrokenFilter(false);
    }
  }, [circuitBrokenCount, circuitBrokenFilter]);

  // Count active filters for mobile badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (viewMode !== "list") count++;
    if (typeFilter !== "all") count++;
    if (statusFilter !== "all") count++;
    if (sortBy !== "priority") count++;
    if (groupFilter.length > 0) count++;
    if (circuitBrokenFilter) count++;
    return count;
  }, [viewMode, typeFilter, statusFilter, sortBy, groupFilter.length, circuitBrokenFilter]);

  // Reset all filters
  const handleResetFilters = useCallback(() => {
    setViewMode("list");
    setTypeFilter("all");
    setStatusFilter("all");
    setSortBy("priority");
    setGroupFilter([]);
    setCircuitBrokenFilter(false);
  }, []);

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

    // Filter by circuit breaker state
    if (circuitBrokenFilter) {
      result = result.filter((p) => healthStatus[p.id]?.circuitState === "open");
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
  }, [
    providers,
    debouncedSearchTerm,
    typeFilter,
    sortBy,
    statusFilter,
    groupFilter,
    circuitBrokenFilter,
    healthStatus,
  ]);

  // Batch selection handlers
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedProviderIds(new Set(filteredProviders.map((p) => p.id)));
      } else {
        setSelectedProviderIds(new Set());
      }
    },
    [filteredProviders]
  );

  const handleInvertSelection = useCallback(() => {
    const currentIds = filteredProviders.map((p) => p.id);
    const inverted = new Set(currentIds.filter((id) => !selectedProviderIds.has(id)));
    setSelectedProviderIds(inverted);
  }, [filteredProviders, selectedProviderIds]);

  const handleSelectProvider = useCallback((providerId: number, checked: boolean) => {
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(providerId);
      } else {
        next.delete(providerId);
      }
      return next;
    });
  }, []);

  const handleEnterMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(true);
  }, []);

  const handleExitMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedProviderIds(new Set());
  }, []);

  const handleOpenBatchEdit = useCallback(() => {
    setBatchActionMode("edit");
    setBatchDialogOpen(true);
  }, []);

  const handleBatchAction = useCallback((mode: BatchActionMode) => {
    setBatchActionMode(mode);
    setBatchDialogOpen(true);
  }, []);

  const handleBatchSuccess = useCallback(() => {
    setSelectedProviderIds(new Set());
    setIsMultiSelectMode(false);
  }, []);

  const allSelected =
    filteredProviders.length > 0 && selectedProviderIds.size === filteredProviders.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ProviderBatchToolbar
          isMultiSelectMode={isMultiSelectMode}
          allSelected={allSelected}
          selectedCount={selectedProviderIds.size}
          totalCount={filteredProviders.length}
          onEnterMode={handleEnterMultiSelectMode}
          onExitMode={handleExitMultiSelectMode}
          onSelectAll={handleSelectAll}
          onInvertSelection={handleInvertSelection}
          onOpenBatchEdit={handleOpenBatchEdit}
        />
        {addDialogSlot ? <div className="ml-auto">{addDialogSlot}</div> : null}
      </div>
      {/* 筛选条件 */}
      <div className="flex flex-col gap-3">
        {/* Mobile Filter Bar */}
        <div className="flex md:hidden items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("placeholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              disabled={loading}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="relative h-9 px-3"
            onClick={() => setMobileFilterOpen(true)}
            disabled={loading}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {/* Mobile Group Filter - Quick Access */}
        {allGroups.length > 0 && (
          <div className="flex md:hidden items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            <Button
              variant={groupFilter.length === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupFilter([])}
              disabled={loading}
              className="h-8 shrink-0"
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
                className="h-8 shrink-0"
              >
                {group}
              </Button>
            ))}
          </div>
        )}

        {/* Mobile Filter Sheet */}
        <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
          <SheetContent side="bottom" className="h-[70vh] overflow-y-auto">
            <SheetHeader className="pb-4">
              <SheetTitle>{tFilter("title")}</SheetTitle>
            </SheetHeader>
            <div className="space-y-6">
              {/* View Mode */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{tStrings("viewMode")}</Label>
                <div className="flex items-center border rounded-md bg-muted/50 p-1 w-fit">
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-3 gap-2"
                    onClick={() => setViewMode("list")}
                  >
                    <LayoutList className="h-4 w-4" />
                    {tStrings("viewModeList")}
                  </Button>
                  <Button
                    variant={viewMode === "vendor" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-3 gap-2"
                    onClick={() => setViewMode("vendor")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    {tStrings("viewModeVendor")}
                  </Button>
                </div>
              </div>

              {/* Type Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{tFilter("type.label")}</Label>
                <ProviderTypeFilter
                  value={typeFilter}
                  onChange={setTypeFilter}
                  disabled={loading}
                />
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{tFilter("status.label")}</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
                  disabled={loading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFilter("status.all")}</SelectItem>
                    <SelectItem value="active">{tFilter("status.active")}</SelectItem>
                    <SelectItem value="inactive">{tFilter("status.inactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{tFilter("sort.label")}</Label>
                <ProviderSortDropdown value={sortBy} onChange={setSortBy} disabled={loading} />
              </div>

              {/* Group Filter */}
              {allGroups.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{tFilter("groups.label")}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={groupFilter.length === 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupFilter([])}
                      disabled={loading}
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
                            prev.includes(group)
                              ? prev.filter((g) => g !== group)
                              : [...prev, group]
                          );
                        }}
                        disabled={loading}
                      >
                        {group}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Circuit Breaker Filter */}
              {circuitBrokenCount > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`h-4 w-4 ${circuitBrokenFilter ? "text-destructive" : "text-muted-foreground"}`}
                    />
                    <Label
                      htmlFor="circuit-broken-filter-mobile"
                      className={`text-sm cursor-pointer select-none ${circuitBrokenFilter ? "text-destructive font-medium" : "text-muted-foreground"}`}
                    >
                      {tFilter("circuitBroken")} ({circuitBrokenCount})
                    </Label>
                  </div>
                  <Switch
                    id="circuit-broken-filter-mobile"
                    checked={circuitBrokenFilter}
                    onCheckedChange={setCircuitBrokenFilter}
                    disabled={loading}
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-4 border-t">
                <Button variant="outline" className="flex-1" onClick={handleResetFilters}>
                  <X className="h-4 w-4 mr-2" />
                  {tFilter("reset")}
                </Button>
                <Button className="flex-1" onClick={() => setMobileFilterOpen(false)}>
                  {tFilter("apply")}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Desktop Filter Bar */}
        <div className="hidden md:flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center border rounded-md bg-muted/50 p-1">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 gap-1.5 text-xs"
              onClick={() => setViewMode("list")}
              title={tStrings("viewModeList")}
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tStrings("viewModeList")}</span>
            </Button>
            <Button
              variant={viewMode === "vendor" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 gap-1.5 text-xs"
              onClick={() => setViewMode("vendor")}
              title={tStrings("viewModeVendor")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tStrings("viewModeVendor")}</span>
            </Button>
          </div>

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
              className="pl-9"
              disabled={loading}
            />
          </div>
        </div>

        {/* Group filter (hidden on mobile - shown in Sheet) */}
        {allGroups.length > 0 && (
          <div className="hidden md:flex flex-wrap gap-2 items-center">
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
        {/* Search results + Circuit Breaker filter (hidden circuit toggle on mobile - shown in Sheet) */}
        <div className="flex items-center justify-between">
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

          {/* Circuit Breaker toggle - only show if there are broken providers (desktop only) */}
          {circuitBrokenCount > 0 && (
            <div className="hidden md:flex items-center gap-2">
              <AlertTriangle
                className={`h-4 w-4 ${circuitBrokenFilter ? "text-destructive" : "text-muted-foreground"}`}
              />
              <Label
                htmlFor="circuit-broken-filter"
                className={`text-sm cursor-pointer select-none ${circuitBrokenFilter ? "text-destructive font-medium" : "text-muted-foreground"}`}
              >
                {tFilter("circuitBroken")}
              </Label>
              <Switch
                id="circuit-broken-filter"
                checked={circuitBrokenFilter}
                onCheckedChange={setCircuitBrokenFilter}
                disabled={loading}
              />
              <span
                className={`text-sm tabular-nums ${circuitBrokenFilter ? "text-destructive font-medium" : "text-muted-foreground"}`}
              >
                ({circuitBrokenCount})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 供应商列表 */}
      {loading && providers.length === 0 ? (
        <ProviderListSkeleton label={tCommon("loading")} />
      ) : (
        <div className="space-y-3">
          {refreshing ? <InlineLoading label={tCommon("loading")} /> : null}

          {viewMode === "list" ? (
            <ProviderList
              providers={filteredProviders}
              currentUser={currentUser}
              healthStatus={healthStatus}
              statistics={statistics}
              statisticsLoading={statisticsLoading}
              currencyCode={currencyCode}
              enableMultiProviderTypes={enableMultiProviderTypes}
              isMultiSelectMode={isMultiSelectMode}
              selectedProviderIds={selectedProviderIds}
              onSelectProvider={handleSelectProvider}
              selectedGroup={groupFilter.length === 1 ? groupFilter[0] : null}
              availableGroups={allGroups}
            />
          ) : (
            <ProviderVendorView
              providers={filteredProviders}
              currentUser={currentUser}
              enableMultiProviderTypes={enableMultiProviderTypes}
              healthStatus={healthStatus}
              statistics={statistics}
              statisticsLoading={statisticsLoading}
              currencyCode={currencyCode}
            />
          )}
        </div>
      )}

      <ProviderBatchActions
        selectedCount={selectedProviderIds.size}
        isVisible={isMultiSelectMode}
        onAction={handleBatchAction}
        onClose={handleExitMultiSelectMode}
      />

      <ProviderBatchDialog
        open={batchDialogOpen}
        mode={batchActionMode}
        onOpenChange={setBatchDialogOpen}
        selectedProviderIds={selectedProviderIds}
        onSuccess={handleBatchSuccess}
      />
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
