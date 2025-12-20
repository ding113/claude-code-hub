"use client";

import { QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import { Key, Loader2, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsers, getUsersBatch } from "@/actions/users";
import { Badge } from "@/components/ui/badge";
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
import type { User, UserDisplay } from "@/types/user";
import { BatchEditDialog } from "../_components/user/batch-edit/batch-edit-dialog";
import { UnifiedEditDialog } from "../_components/user/unified-edit-dialog";
import { UserManagementTable } from "../_components/user/user-management-table";
import { UserOnboardingTour } from "../_components/user/user-onboarding-tour";

const ONBOARDING_KEY = "cch-users-onboarding-seen";
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
  const isAdmin = currentUser.role === "admin";
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [keyGroupFilter, setKeyGroupFilter] = useState("all");

  // Debounce search term to avoid frequent API requests
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Use debounced value for API queries, raw value for UI highlighting
  const resolvedSearchTerm = debouncedSearchTerm.trim() ? debouncedSearchTerm.trim() : undefined;
  const resolvedTagFilter = tagFilter === "all" ? undefined : tagFilter;
  const resolvedKeyGroupFilter = keyGroupFilter === "all" ? undefined : keyGroupFilter;

  // Stable queryKey for non-admin users to avoid unnecessary cache entries
  const queryKey = useMemo(
    () =>
      isAdmin
        ? ["users", resolvedSearchTerm, resolvedTagFilter, resolvedKeyGroupFilter]
        : ["users", "self"],
    [isAdmin, resolvedSearchTerm, resolvedTagFilter, resolvedKeyGroupFilter]
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
        tagFilter: resolvedTagFilter,
        keyGroupFilter: resolvedKeyGroupFilter,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as { id: number; createdAt: string } | undefined,
  });

  const allUsers = useMemo(() => data?.pages.flatMap((page) => page.users) ?? [], [data]);
  const visibleUsers = useMemo(() => {
    if (isAdmin) return allUsers;
    return allUsers.filter((user) => user.id === currentUser.id);
  }, [isAdmin, allUsers, currentUser.id]);

  const isInitialLoading = isLoading && allUsers.length === 0;
  const isRefreshing = isFetching && !isInitialLoading && !isFetchingNextPage;

  // Batch edit / multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(() => new Set());
  const [selectedKeyIds, setSelectedKeyIds] = useState<Set<number>>(() => new Set());
  const [batchEditDialogOpen, setBatchEditDialogOpen] = useState(false);

  // Onboarding and create dialog state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(true);

  // Check localStorage for onboarding status on mount
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const seen = localStorage.getItem(ONBOARDING_KEY);
        setHasSeenOnboarding(seen === "true");
      }
    } catch {
      // localStorage not available (e.g., privacy mode)
      setHasSeenOnboarding(true);
    }
  }, []);

  const handleCreateUser = useCallback(() => {
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    } else {
      setShowCreateDialog(true);
    }
  }, [hasSeenOnboarding]);

  const handleCreateKey = useCallback(() => {
    setShowCreateDialog(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(ONBOARDING_KEY, "true");
      }
    } catch {
      // localStorage not available
    }
    setHasSeenOnboarding(true);
    setShowCreateDialog(true);
  }, []);

  const handleCreateDialogClose = useCallback((open: boolean) => {
    setShowCreateDialog(open);
  }, []);

  // Extract unique tags from users
  const uniqueTags = useMemo(() => {
    const tags = visibleUsers.flatMap((u) => u.tags || []);
    return [...new Set(tags)].sort();
  }, [visibleUsers]);

  // Extract unique key groups from users (split comma-separated tags)
  const uniqueKeyGroups = useMemo(() => {
    const groups = visibleUsers.flatMap(
      (u) => u.keys?.flatMap((k) => splitTags(k.providerGroup)) || []
    );
    return [...new Set(groups)].sort();
  }, [visibleUsers]);

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
          keyGroupFilter !== "all" && splitTags(key.providerGroup).includes(keyGroupFilter);

        if (matchesSearch || matchesKeyGroup) {
          matchingIds.add(key.id);
        }
      }
    }

    return matchingIds;
  }, [visibleUsers, searchTerm, keyGroupFilter]);

  // Determine if we should highlight keys (either search or keyGroup filter is active)
  const shouldHighlightKeys = searchTerm.trim().length > 0 || keyGroupFilter !== "all";
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
      `${resolvedSearchTerm ?? ""}|${resolvedTagFilter ?? "all"}|${resolvedKeyGroupFilter ?? "all"}`,
    [resolvedSearchTerm, resolvedTagFilter, resolvedKeyGroupFilter]
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
        {isAdmin ? (
          <Button onClick={handleCreateUser}>
            <Plus className="mr-2 h-4 w-4" />
            {t("toolbar.createUser")}
          </Button>
        ) : (
          <Button onClick={handleCreateKey}>
            <Key className="mr-2 h-4 w-4" />
            {t("toolbar.createKey")}
          </Button>
        )}
      </div>

      {/* Toolbar with search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Search input */}
        <div className="relative flex-1 max-w-sm">
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
            {/* Tag filter */}
            {isInitialLoading ? (
              <Skeleton className="h-9 w-[180px]" />
            ) : (
              uniqueTags.length > 0 && (
                <Select value={tagFilter} onValueChange={setTagFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t("toolbar.tagFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("toolbar.allTags")}</SelectItem>
                    {uniqueTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        <Badge variant="secondary" className="mr-1 text-xs">
                          {tag}
                        </Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            )}

            {/* Key group filter */}
            {isInitialLoading ? (
              <Skeleton className="h-9 w-[180px]" />
            ) : (
              uniqueKeyGroups.length > 0 && (
                <Select value={keyGroupFilter} onValueChange={setKeyGroupFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t("toolbar.keyGroupFilter")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("toolbar.allKeyGroups")}</SelectItem>
                    {uniqueKeyGroups.map((group) => (
                      <SelectItem key={group} value={group}>
                        <Badge variant="outline" className="mr-1 text-xs">
                          {group}
                        </Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            )}
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
          {isRefreshing ? <InlineLoading label={tCommon("loading")} /> : null}
          <UserManagementTable
            users={visibleUsers}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={fetchNextPage}
            scrollResetKey={scrollResetKey}
            currentUser={currentUser}
            currencyCode="USD"
            onCreateUser={isAdmin ? handleCreateUser : handleCreateKey}
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

      {/* Onboarding Tour */}
      <UserOnboardingTour
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onComplete={handleOnboardingComplete}
      />

      {/* Create User Dialog */}
      <UnifiedEditDialog
        open={showCreateDialog}
        onOpenChange={handleCreateDialogClose}
        mode="create"
        user={selfUser}
        keyOnlyMode={!isAdmin}
        currentUser={currentUser}
      />
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
