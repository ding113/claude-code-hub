"use client";

import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAllUserKeyGroups, getAllUserTags, getUsers, getUsersBatch } from "@/actions/users";
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
import { TagInput } from "@/components/ui/tag-input";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { User, UserDisplay } from "@/types/user";
import { AddKeyDialog } from "../_components/user/add-key-dialog";
import { BatchEditDialog } from "../_components/user/batch-edit/batch-edit-dialog";
import { CreateUserDialog } from "../_components/user/create-user-dialog";
import { UserManagementTable } from "../_components/user/user-management-table";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

/**
 * Split comma-separated tags into an array of trimmed, non-empty strings.
 * This matches the server-side providerGroup handling in provider-selector.ts
 */
function splitTags(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

interface UsersPageClientProps {
  initialUsers?: UserDisplay[];
  currentUser: User;
}

export function UsersPageClient(props: UsersPageClientProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <UsersPageContent {...props} />
    </QueryClientProvider>
  );
}

function UsersPageContent({ currentUser }: UsersPageClientProps) {
  const t = useTranslations("dashboard.users");
  const tUserMgmt = useTranslations("dashboard.userManagement");
  const tKeyList = useTranslations("dashboard.keyList");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const isAdmin = currentUser.role === "admin";
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [pendingTagFilters, setPendingTagFilters] = useState<string[]>([]);
  const [keyGroupFilters, setKeyGroupFilters] = useState<string[]>([]);
  const [pendingKeyGroupFilters, setPendingKeyGroupFilters] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "expired" | "expiringSoon" | "enabled" | "disabled"
  >("all");
  const [sortBy, setSortBy] = useState<
    | "name"
    | "tags"
    | "expiresAt"
    | "rpm"
    | "limit5hUsd"
    | "limitDailyUsd"
    | "limitWeeklyUsd"
    | "limitMonthlyUsd"
    | "createdAt"
  >("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Debounce search term to avoid frequent API requests
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const debouncedPendingTagsKey = useDebounce(pendingTagFilters.slice().sort().join("|"), 300);
  const debouncedPendingKeyGroupsKey = useDebounce(
    pendingKeyGroupFilters.slice().sort().join("|"),
    300
  );

  // Use debounced value for API queries, raw value for UI highlighting
  const resolvedSearchTerm = debouncedSearchTerm.trim() ? debouncedSearchTerm.trim() : undefined;
  const resolvedTagFilters = tagFilters.length > 0 ? tagFilters : undefined;
  const resolvedKeyGroupFilters = keyGroupFilters.length > 0 ? keyGroupFilters : undefined;
  const resolvedStatusFilter = statusFilter === "all" ? undefined : statusFilter;

  // Stable queryKey for non-admin users to avoid unnecessary cache entries
  const queryKey = useMemo(
    () =>
      isAdmin
        ? [
            "users",
            resolvedSearchTerm,
            resolvedTagFilters,
            resolvedKeyGroupFilters,
            resolvedStatusFilter,
            sortBy,
            sortOrder,
          ]
        : ["users", "self"],
    [
      isAdmin,
      resolvedSearchTerm,
      resolvedTagFilters,
      resolvedKeyGroupFilters,
      resolvedStatusFilter,
      sortBy,
      sortOrder,
    ]
  );

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (!isAdmin) {
        const users = await getUsers();
        return { users, nextCursor: null, hasMore: false };
      }

      const result = await getUsersBatch({
        cursor: pageParam,
        limit: 50,
        searchTerm: resolvedSearchTerm,
        tagFilters: resolvedTagFilters,
        keyGroupFilters: resolvedKeyGroupFilters,
        statusFilter: resolvedStatusFilter,
        sortBy,
        sortOrder,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
  });

  // Independent tag query - breaks circular dependency
  const { data: allTags = [] } = useQuery({
    queryKey: ["userTags"],
    queryFn: async () => {
      const result = await getAllUserTags();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: isAdmin,
  });

  const { data: allKeyGroups = [] } = useQuery({
    queryKey: ["userKeyGroups"],
    queryFn: async () => {
      const result = await getAllUserKeyGroups();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: isAdmin,
  });

  const allUsers = useMemo(() => data?.pages.flatMap((page) => page.users) ?? [], [data]);
  const visibleUsers = useMemo(() => {
    if (isAdmin) return allUsers;
    return allUsers.filter((user) => user.id === currentUser.id);
  }, [isAdmin, allUsers, currentUser.id]);

  const isInitialLoading = isLoading && allUsers.length === 0;
  const isRefreshing = isFetching && !isInitialLoading && !isFetchingNextPage;

  useEffect(() => {
    setPendingTagFilters(tagFilters);
  }, [tagFilters]);

  useEffect(() => {
    setPendingKeyGroupFilters(keyGroupFilters);
  }, [keyGroupFilters]);

  useEffect(() => {
    const appliedKey = tagFilters.slice().sort().join("|");
    if (debouncedPendingTagsKey !== appliedKey) {
      setTagFilters(pendingTagFilters);
    }
  }, [debouncedPendingTagsKey, pendingTagFilters, tagFilters]);

  useEffect(() => {
    const appliedKey = keyGroupFilters.slice().sort().join("|");
    if (debouncedPendingKeyGroupsKey !== appliedKey) {
      setKeyGroupFilters(pendingKeyGroupFilters);
    }
  }, [debouncedPendingKeyGroupsKey, pendingKeyGroupFilters, keyGroupFilters]);

  // Batch edit / multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(() => new Set());
  const [selectedKeyIds, setSelectedKeyIds] = useState<Set<number>>(() => new Set());
  const [batchEditDialogOpen, setBatchEditDialogOpen] = useState(false);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Add key dialog state
  const [showAddKeyDialog, setShowAddKeyDialog] = useState(false);
  const [addKeyUser, setAddKeyUser] = useState<UserDisplay | null>(null);

  const handleCreateUser = useCallback(() => {
    setShowCreateDialog(true);
  }, []);

  const handleCreateKey = useCallback(() => {
    setShowCreateDialog(true);
  }, []);

  const handleCreateDialogClose = useCallback((open: boolean) => {
    setShowCreateDialog(open);
  }, []);

  const handleAddKey = useCallback((user: UserDisplay) => {
    setAddKeyUser(user);
    setShowAddKeyDialog(true);
  }, []);

  const handleAddKeyDialogClose = useCallback((open: boolean) => {
    setShowAddKeyDialog(open);
    if (!open) {
      setAddKeyUser(null);
    }
  }, []);

  const handleKeyCreated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  }, [queryClient]);

  const hasPendingFilterChanges = useMemo(() => {
    const normalize = (values: string[]) => [...values].sort().join("|");
    return (
      normalize(pendingTagFilters) !== normalize(tagFilters) ||
      normalize(pendingKeyGroupFilters) !== normalize(keyGroupFilters)
    );
  }, [pendingTagFilters, tagFilters, pendingKeyGroupFilters, keyGroupFilters]);

  const handleApplyFilters = useCallback(() => {
    if (!hasPendingFilterChanges) return;
    setTagFilters(pendingTagFilters);
    setKeyGroupFilters(pendingKeyGroupFilters);
  }, [pendingTagFilters, pendingKeyGroupFilters, hasPendingFilterChanges]);

  const handleTagCommit = useCallback((nextTags: string[]) => {
    setTagFilters(nextTags);
    setPendingTagFilters(nextTags);
  }, []);

  const handleKeyGroupCommit = useCallback((nextGroups: string[]) => {
    setKeyGroupFilters(nextGroups);
    setPendingKeyGroupFilters(nextGroups);
  }, []);

  // Use independent query instead of circular dependency
  const uniqueTags = isAdmin ? allTags : [];

  const uniqueKeyGroups = isAdmin ? allKeyGroups : [];

  const matchingKeyIds = useMemo(() => {
    const matchingIds = new Set<number>();
    const normalizedTerm = searchTerm.trim().toLowerCase();
    const hasSearch = normalizedTerm.length > 0;

    for (const user of visibleUsers) {
      if (user.keys.length === 0) continue;

      for (const key of user.keys) {
        const matchesSearch =
          hasSearch &&
          (key.name.toLowerCase().includes(normalizedTerm) ||
            key.maskedKey.toLowerCase().includes(normalizedTerm) ||
            (key.fullKey || "").toLowerCase().includes(normalizedTerm) ||
            (key.providerGroup || "").toLowerCase().includes(normalizedTerm));

        const matchesKeyGroup =
          keyGroupFilters.length > 0 &&
          keyGroupFilters.some((filter) => splitTags(key.providerGroup).includes(filter));

        if (matchesSearch || matchesKeyGroup) {
          matchingIds.add(key.id);
        }
      }
    }

    return matchingIds;
  }, [visibleUsers, searchTerm, keyGroupFilters]);

  // Determine if we should highlight keys (either search or keyGroup filter is active)
  const shouldHighlightKeys = searchTerm.trim().length > 0 || keyGroupFilters.length > 0;
  const selfUser = useMemo(() => (isAdmin ? undefined : visibleUsers[0]), [isAdmin, visibleUsers]);

  const allVisibleUserIds = useMemo(() => visibleUsers.map((user) => user.id), [visibleUsers]);
  const allVisibleKeyIds = useMemo(
    () => visibleUsers.flatMap((user) => user.keys?.map((key) => key.id) ?? []),
    [visibleUsers]
  );

  // Keep selection consistent with current filtered list while in multi-select mode.
  useEffect(() => {
    if (!isMultiSelectMode) return;
    const validUserIds = new Set(allVisibleUserIds);
    const validKeyIds = new Set(allVisibleKeyIds);

    setSelectedUserIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (validUserIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });

    setSelectedKeyIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (validKeyIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [isMultiSelectMode, allVisibleUserIds, allVisibleKeyIds]);

  const enterMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(true);
  }, []);

  const exitMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedUserIds(new Set());
    setSelectedKeyIds(new Set());
    setBatchEditDialogOpen(false);
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setSelectedUserIds(new Set());
        setSelectedKeyIds(new Set());
        return;
      }
      setSelectedUserIds(new Set(allVisibleUserIds));
      setSelectedKeyIds(new Set(allVisibleKeyIds));
    },
    [allVisibleUserIds, allVisibleKeyIds]
  );

  const handleSelectUser = useCallback((user: UserDisplay, checked: boolean) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(user.id);
      else next.delete(user.id);
      return next;
    });

    setSelectedKeyIds((prev) => {
      const next = new Set(prev);
      for (const key of user.keys ?? []) {
        if (checked) next.add(key.id);
        else next.delete(key.id);
      }
      return next;
    });
  }, []);

  const handleSelectKey = useCallback((keyId: number, checked: boolean) => {
    setSelectedKeyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(keyId);
      else next.delete(keyId);
      return next;
    });
  }, []);

  const handleBatchEditSuccess = useCallback(() => {
    setSelectedUserIds(new Set());
    setSelectedKeyIds(new Set());
    setBatchEditDialogOpen(false);
  }, []);

  const handleOpenBatchEdit = useCallback(() => {
    setBatchEditDialogOpen(true);
  }, []);

  // Memoize translations object to prevent unnecessary re-renders
  const tableTranslations = useMemo(
    () => ({
      table: {
        columns: {
          username: tUserMgmt("table.columns.username"),
          note: tUserMgmt("table.columns.note"),
          expiresAt: tUserMgmt("table.columns.expiresAt"),
          limitRpm: tUserMgmt("table.columns.limitRpm"),
          limit5h: tUserMgmt("table.columns.limit5h"),
          limitDaily: tUserMgmt("table.columns.limitDaily"),
          limitWeekly: tUserMgmt("table.columns.limitWeekly"),
          limitMonthly: tUserMgmt("table.columns.limitMonthly"),
          limitTotal: tUserMgmt("table.columns.limitTotal"),
          limitSessions: tUserMgmt("table.columns.limitSessions"),
        },
        keyRow: {
          fields: {
            name: tUserMgmt("table.keyRow.name"),
            key: tUserMgmt("table.keyRow.key"),
            group: tUserMgmt("table.keyRow.group"),
            todayUsage: tUserMgmt("table.keyRow.todayUsage"),
            todayCost: tUserMgmt("table.keyRow.todayCost"),
            lastUsed: tUserMgmt("table.keyRow.lastUsed"),
            actions: tUserMgmt("table.keyRow.actions"),
            callsLabel: tUserMgmt("table.keyRow.fields.callsLabel"),
            costLabel: tUserMgmt("table.keyRow.fields.costLabel"),
          },
          actions: {
            details: tKeyList("detailsButton"),
            logs: tKeyList("logsButton"),
            edit: tCommon("edit"),
            delete: tCommon("delete"),
            copy: tCommon("copy"),
            copySuccess: tCommon("copySuccess"),
            copyFailed: tCommon("copyFailed"),
            show: tKeyList("showKeyTooltip"),
            hide: tKeyList("hideKeyTooltip"),
            quota: tUserMgmt("table.keyRow.quotaButton"),
          },
          status: {
            enabled: tUserMgmt("keyStatus.enabled"),
            disabled: tUserMgmt("keyStatus.disabled"),
          },
        },
        expand: tUserMgmt("table.expand"),
        collapse: tUserMgmt("table.collapse"),
        noKeys: tUserMgmt("table.noKeys"),
        defaultGroup: tUserMgmt("table.defaultGroup"),
      },
      editDialog: {},
      actions: {
        edit: tCommon("edit"),
        details: tKeyList("detailsButton"),
        logs: tKeyList("logsButton"),
        delete: tCommon("delete"),
      },
    }),
    [tUserMgmt, tKeyList, tCommon]
  );

  const scrollResetKey = useMemo(
    () =>
      `${resolvedSearchTerm ?? ""}|${resolvedTagFilters?.join(",") ?? "all"}|${resolvedKeyGroupFilters?.join(",") ?? "all"}|${resolvedStatusFilter ?? "all"}|${sortBy}|${sortOrder}`,
    [
      resolvedSearchTerm,
      resolvedTagFilters,
      resolvedKeyGroupFilters,
      resolvedStatusFilter,
      sortBy,
      sortOrder,
    ]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {isInitialLoading
              ? tCommon("loading")
              : t("description", { count: visibleUsers.length })}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleCreateUser}>
            <Plus className="mr-2 h-4 w-4" />
            {t("toolbar.createUser")}
          </Button>
        )}
      </div>

      {/* Toolbar with search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Search input */}
        <div className="relative flex-1 min-w-[220px] sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("toolbar.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {isAdmin ? (
          <>
            {/* Tag filter - Multi-select */}
            {isInitialLoading ? (
              <Skeleton className="h-9 w-[240px]" />
            ) : (
              uniqueTags.length > 0 && (
                <div className="w-[200px] sm:w-[220px]">
                  <TagInput
                    value={pendingTagFilters}
                    onChange={setPendingTagFilters}
                    onChangeCommit={handleTagCommit}
                    suggestions={uniqueTags}
                    placeholder={t("toolbar.tagFilter")}
                    maxVisibleTags={2}
                    allowDuplicates={false}
                    validateTag={(tag) => uniqueTags.includes(tag)}
                    onSuggestionsClose={handleApplyFilters}
                    clearable
                    clearLabel={tCommon("clear")}
                    className="h-9 flex-nowrap items-center overflow-hidden py-1"
                  />
                </div>
              )
            )}

            {/* Key group filter */}
            {isInitialLoading ? (
              <Skeleton className="h-9 w-[240px]" />
            ) : (
              uniqueKeyGroups.length > 0 && (
                <div className="w-[200px] sm:w-[220px]">
                  <TagInput
                    value={pendingKeyGroupFilters}
                    onChange={setPendingKeyGroupFilters}
                    onChangeCommit={handleKeyGroupCommit}
                    suggestions={uniqueKeyGroups}
                    placeholder={t("toolbar.keyGroupFilter")}
                    maxVisibleTags={2}
                    allowDuplicates={false}
                    validateTag={(tag) => uniqueKeyGroups.includes(tag)}
                    onSuggestionsClose={handleApplyFilters}
                    clearable
                    clearLabel={tCommon("clear")}
                    className="h-9 flex-nowrap items-center overflow-hidden py-1"
                  />
                </div>
              )
            )}

            {/* Sort by field */}
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("toolbar.sortBy")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">{t("toolbar.sortByCreatedAt")}</SelectItem>
                <SelectItem value="name">{t("toolbar.sortByName")}</SelectItem>
                <SelectItem value="tags">{t("toolbar.sortByTags")}</SelectItem>
                <SelectItem value="expiresAt">{t("toolbar.sortByExpiresAt")}</SelectItem>
                <SelectItem value="rpm">{t("toolbar.sortByRpm")}</SelectItem>
                <SelectItem value="limit5hUsd">{t("toolbar.sortByLimit5h")}</SelectItem>
                <SelectItem value="limitDailyUsd">{t("toolbar.sortByLimitDaily")}</SelectItem>
                <SelectItem value="limitWeeklyUsd">{t("toolbar.sortByLimitWeekly")}</SelectItem>
                <SelectItem value="limitMonthlyUsd">{t("toolbar.sortByLimitMonthly")}</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort order */}
            <Select
              value={sortOrder}
              onValueChange={(value) => setSortOrder(value as "asc" | "desc")}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder={t("toolbar.sortOrder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">{t("toolbar.ascending")}</SelectItem>
                <SelectItem value="desc">{t("toolbar.descending")}</SelectItem>
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("toolbar.statusFilter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("toolbar.allStatus")}</SelectItem>
                <SelectItem value="active">{t("toolbar.statusActive")}</SelectItem>
                <SelectItem value="expired">{t("toolbar.statusExpired")}</SelectItem>
                <SelectItem value="expiringSoon">{t("toolbar.statusExpiringSoon")}</SelectItem>
                <SelectItem value="enabled">{t("toolbar.statusEnabled")}</SelectItem>
                <SelectItem value="disabled">{t("toolbar.statusDisabled")}</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>

      {isInitialLoading ? (
        <UsersTableSkeleton label={tCommon("loading")} />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : tCommon("error")}
        </div>
      ) : (
        <div className="space-y-3">
          <div>{isRefreshing ? <InlineLoading label={tCommon("loading")} /> : null}</div>
          <UserManagementTable
            users={visibleUsers}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={fetchNextPage}
            scrollResetKey={scrollResetKey}
            currentUser={currentUser}
            currencyCode="USD"
            onCreateUser={isAdmin ? handleCreateUser : handleCreateKey}
            onAddKey={handleAddKey}
            highlightKeyIds={shouldHighlightKeys ? matchingKeyIds : undefined}
            autoExpandOnFilter={shouldHighlightKeys}
            isMultiSelectMode={isAdmin && isMultiSelectMode}
            selectedUserIds={selectedUserIds}
            selectedKeyIds={selectedKeyIds}
            onEnterMultiSelectMode={enterMultiSelectMode}
            onExitMultiSelectMode={exitMultiSelectMode}
            onSelectAll={handleSelectAll}
            onSelectUser={handleSelectUser}
            onSelectKey={handleSelectKey}
            onOpenBatchEdit={handleOpenBatchEdit}
            translations={tableTranslations}
          />
        </div>
      )}

      {isAdmin ? (
        <BatchEditDialog
          open={batchEditDialogOpen}
          onOpenChange={setBatchEditDialogOpen}
          selectedUserIds={selectedUserIds}
          selectedKeyIds={selectedKeyIds}
          onSuccess={handleBatchEditSuccess}
        />
      ) : null}

      {/* Create User Dialog (Admin) or Add Key Dialog (non-Admin) */}
      {isAdmin ? (
        <CreateUserDialog open={showCreateDialog} onOpenChange={handleCreateDialogClose} />
      ) : selfUser ? (
        <AddKeyDialog
          open={showCreateDialog}
          onOpenChange={handleCreateDialogClose}
          userId={selfUser.id}
          user={{
            id: selfUser.id,
            providerGroup: selfUser.providerGroup ?? null,
            limit5hUsd: selfUser.limit5hUsd ?? undefined,
            limitWeeklyUsd: selfUser.limitWeeklyUsd ?? undefined,
            limitMonthlyUsd: selfUser.limitMonthlyUsd ?? undefined,
            limitTotalUsd: selfUser.limitTotalUsd ?? undefined,
            limitConcurrentSessions: selfUser.limitConcurrentSessions ?? undefined,
          }}
          isAdmin={false}
          onSuccess={handleKeyCreated}
        />
      ) : null}

      {/* Add Key Dialog (triggered from key list) */}
      {addKeyUser && (
        <AddKeyDialog
          open={showAddKeyDialog}
          onOpenChange={handleAddKeyDialogClose}
          userId={addKeyUser.id}
          user={{
            id: addKeyUser.id,
            providerGroup: addKeyUser.providerGroup ?? null,
            limit5hUsd: addKeyUser.limit5hUsd ?? undefined,
            limitWeeklyUsd: addKeyUser.limitWeeklyUsd ?? undefined,
            limitMonthlyUsd: addKeyUser.limitMonthlyUsd ?? undefined,
            limitTotalUsd: addKeyUser.limitTotalUsd ?? undefined,
            limitConcurrentSessions: addKeyUser.limitConcurrentSessions ?? undefined,
          }}
          isAdmin={isAdmin}
          onSuccess={handleKeyCreated}
        />
      )}
    </div>
  );
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function UsersTableSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4" aria-busy="true">
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
      <InlineLoading label={label} />
    </div>
  );
}
