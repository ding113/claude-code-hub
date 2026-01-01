"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { renewUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { useVirtualizer } from "@/hooks/use-virtualizer";
import { cn } from "@/lib/utils";
import type { User, UserDisplay } from "@/types/user";
import { BatchEditToolbar } from "./batch-edit/batch-edit-toolbar";
import { QuickRenewDialog, type QuickRenewUser } from "./forms/quick-renew-dialog";
import { UnifiedEditDialog } from "./unified-edit-dialog";
import { UserKeyTableRow } from "./user-key-table-row";

export interface UserManagementTableProps {
  users: UserDisplay[];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  /** Used to reset virtual scroll position when filters change. */
  scrollResetKey?: string;
  currentUser?: User;
  currencyCode?: string;
  onCreateUser?: () => void;
  highlightKeyIds?: Set<number>;
  autoExpandOnFilter?: boolean;
  isMultiSelectMode?: boolean;
  selectedUserIds?: Set<number>;
  selectedKeyIds?: Set<number>;
  onEnterMultiSelectMode?: () => void;
  onExitMultiSelectMode?: () => void;
  onSelectAll?: (checked: boolean) => void;
  onSelectUser?: (user: UserDisplay, checked: boolean) => void;
  onSelectKey?: (keyId: number, checked: boolean) => void;
  onOpenBatchEdit?: () => void;
  translations: {
    table: {
      columns: {
        username: string;
        note: string;
        expiresAt: string;
        expiresAtHint?: string;
        limitRpm: string;
        limit5h: string;
        limitDaily: string;
        limitWeekly: string;
        limitMonthly: string;
        limitTotal: string;
        limitSessions: string;
      };
      keyRow: any;
      expand: string;
      collapse: string;
      noKeys: string;
      defaultGroup: string;
    };
    editDialog: any;
    actions: {
      edit: string;
      details: string;
      logs: string;
      delete: string;
    };
    quickRenew?: {
      title: string;
      description: string;
      currentExpiry: string;
      neverExpires: string;
      expired: string;
      quickExtensionLabel: string;
      quickExtensionHint: string;
      customDateLabel: string;
      customDateHint: string;
      quickOptions: {
        "7days": string;
        "30days": string;
        "90days": string;
        "1year": string;
      };
      customDate: string;
      enableOnRenew: string;
      cancel: string;
      confirm: string;
      confirming: string;
      success: string;
      failed: string;
    };
  };
}

const USER_ROW_HEIGHT = 52;
const KEY_ROW_HEIGHT = 40;
const KEY_ROW_BORDER_HEIGHT = 1;
const EXPANDED_SECTION_PADDING = 24; // py-3 * 2
const KEY_LIST_BORDER_HEIGHT = 2; // top + bottom border
const EMPTY_KEYS_HEIGHT = 68; // py-6 * 2 + line height
const MIN_TABLE_WIDTH_CLASS = "min-w-[1070px]";
const GRID_COLUMNS_CLASS = "grid-cols-[minmax(260px,1fr)_120px_repeat(7,90px)_80px]";

export function UserManagementTable({
  users,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  scrollResetKey,
  currentUser,
  currencyCode,
  onCreateUser,
  highlightKeyIds,
  autoExpandOnFilter,
  isMultiSelectMode,
  selectedUserIds,
  selectedKeyIds,
  onEnterMultiSelectMode,
  onExitMultiSelectMode,
  onSelectAll,
  onSelectUser,
  onSelectKey,
  onOpenBatchEdit,
  translations,
}: UserManagementTableProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tUserList = useTranslations("dashboard.userList");
  const tUserMgmt = useTranslations("dashboard.userManagement");
  const isAdmin = currentUser?.role === "admin";
  const showMultiSelect = Boolean(isAdmin && isMultiSelectMode);
  // Use useMemo to create stable empty Set references for fallback
  const emptySet = useMemo(() => new Set<number>(), []);
  const selectedUserIdSet = selectedUserIds ?? emptySet;
  const selectedKeyIdSet = selectedKeyIds ?? emptySet;
  const [expandedUsers, setExpandedUsers] = useState<Map<number, boolean>>(
    () => new Map(users.map((user) => [user.id, false]))
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const prevAutoExpandRef = useRef(autoExpandOnFilter);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [scrollToKeyId, setScrollToKeyId] = useState<number | undefined>(undefined);

  // Quick renew dialog state
  const [quickRenewOpen, setQuickRenewOpen] = useState(false);
  const [quickRenewUser, setQuickRenewUser] = useState<QuickRenewUser | null>(null);
  // 乐观更新：跟踪用户过期时间的即时更新
  const [optimisticUserExpiries, setOptimisticUserExpiries] = useState<Map<number, Date>>(
    () => new Map()
  );

  useEffect(() => {
    setExpandedUsers((prev) => {
      const next = new Map<number, boolean>();
      for (const user of users) {
        next.set(user.id, prev.get(user.id) ?? false);
      }

      if (next.size !== prev.size) return next;
      for (const [userId, expanded] of next) {
        if (prev.get(userId) !== expanded) return next;
      }
      return prev;
    });
  }, [users]);

  useEffect(() => {
    if (autoExpandOnFilter && !prevAutoExpandRef.current) {
      setExpandedUsers(new Map(users.map((user) => [user.id, true])));
    }
    prevAutoExpandRef.current = autoExpandOnFilter;
  }, [autoExpandOnFilter, users]);

  const allExpanded = useMemo(() => {
    if (users.length === 0) return false;
    return users.every((user) => expandedUsers.get(user.id) ?? false);
  }, [users, expandedUsers]);

  const totalKeyCount = useMemo(() => {
    let total = 0;
    for (const user of users) {
      total += user.keys?.length ?? 0;
    }
    return total;
  }, [users]);

  const allSelected =
    showMultiSelect &&
    users.length > 0 &&
    selectedUserIdSet.size === users.length &&
    selectedKeyIdSet.size === totalKeyCount;

  const rowTranslations = useMemo(() => {
    return {
      columns: {
        ...translations.table.columns,
        expiresAtHint: isAdmin
          ? translations.table.columns.expiresAtHint || tUserMgmt("table.columns.expiresAtHint")
          : undefined,
      },
      keyRow: translations.table.keyRow,
      expand: translations.table.expand,
      collapse: translations.table.collapse,
      noKeys: translations.table.noKeys,
      defaultGroup: translations.table.defaultGroup,
      actions: translations.actions,
      userStatus: {
        disabled: tUserMgmt("keyStatus.disabled"),
      },
    };
  }, [translations, isAdmin, tUserMgmt]);

  // Memoize estimateSize to prevent virtualizer re-computation
  const estimateSize = useCallback(
    (index: number) => {
      const user = users[index];
      if (!user) return USER_ROW_HEIGHT;
      const expanded = showMultiSelect ? true : (expandedUsers.get(user.id) ?? false);
      if (!expanded) return USER_ROW_HEIGHT;
      const keyCount = user.keys?.length ?? 0;
      if (keyCount === 0) {
        return USER_ROW_HEIGHT + EXPANDED_SECTION_PADDING + EMPTY_KEYS_HEIGHT;
      }
      const keyBorders = Math.max(0, keyCount - 1) * KEY_ROW_BORDER_HEIGHT;
      return (
        USER_ROW_HEIGHT +
        EXPANDED_SECTION_PADDING +
        KEY_LIST_BORDER_HEIGHT +
        keyCount * KEY_ROW_HEIGHT +
        keyBorders
      );
    },
    [users, showMultiSelect, expandedUsers]
  );

  const getScrollElement = useCallback(() => parentRef.current, []);

  const getItemKey = useCallback((index: number) => users[index]?.id ?? `loader-${index}`, [users]);

  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? users.length + 1 : users.length,
    getScrollElement,
    // Stable key function to prevent measurement cache mismatches during filtering/reordering
    getItemKey,
    estimateSize,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (!onLoadMore) return;
    if (!hasNextPage) return;
    if (isFetchingNextPage) return;
    if (lastItemIndex >= users.length - 5) {
      onLoadMore();
    }
  }, [lastItemIndex, users.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  useEffect(() => {
    if (!scrollResetKey) return;
    parentRef.current?.scrollTo({ top: 0 });
    rowVirtualizer.measure();
  }, [scrollResetKey, rowVirtualizer]);

  const quickRenewTranslations = useMemo(() => {
    if (translations.quickRenew) return translations.quickRenew;
    // Fallback to translation keys
    return {
      title: tUserMgmt("quickRenew.title"),
      description: tUserMgmt("quickRenew.description", { userName: "{userName}" }),
      currentExpiry: tUserMgmt("quickRenew.currentExpiry"),
      neverExpires: tUserMgmt("quickRenew.neverExpires"),
      expired: tUserMgmt("quickRenew.expired"),
      quickExtensionLabel: tUserMgmt("quickRenew.quickExtensionLabel"),
      quickExtensionHint: tUserMgmt("quickRenew.quickExtensionHint"),
      customDateLabel: tUserMgmt("quickRenew.customDateLabel"),
      customDateHint: tUserMgmt("quickRenew.customDateHint"),
      quickOptions: {
        "7days": tUserMgmt("quickRenew.quickOptions.7days"),
        "30days": tUserMgmt("quickRenew.quickOptions.30days"),
        "90days": tUserMgmt("quickRenew.quickOptions.90days"),
        "1year": tUserMgmt("quickRenew.quickOptions.1year"),
      },
      customDate: tUserMgmt("quickRenew.customDate"),
      enableOnRenew: tUserMgmt("quickRenew.enableOnRenew"),
      cancel: tUserMgmt("quickRenew.cancel"),
      confirm: tUserMgmt("quickRenew.confirm"),
      confirming: tUserMgmt("quickRenew.confirming"),
    };
  }, [translations.quickRenew, tUserMgmt]);

  const editingUser = useMemo(() => {
    if (!editingUserId) return null;
    return users.find((u) => u.id === editingUserId) ?? null;
  }, [users, editingUserId]);

  useEffect(() => {
    if (!editDialogOpen) return;
    if (!editingUser) {
      setEditDialogOpen(false);
      setEditingUserId(null);
      setScrollToKeyId(undefined);
    }
  }, [editDialogOpen, editingUser]);

  const handleToggleUser = (userId: number) => {
    setExpandedUsers((prev) => {
      const next = new Map(prev);
      next.set(userId, !(prev.get(userId) ?? false));
      return next;
    });
  };

  const handleToggleAll = () => {
    const nextExpanded = !allExpanded;
    setExpandedUsers(new Map(users.map((user) => [user.id, nextExpanded])));
  };

  const openEditDialog = (userId: number, keyId?: number) => {
    setEditingUserId(userId);
    setScrollToKeyId(keyId);
    setEditDialogOpen(true);
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (open) return;
    setEditingUserId(null);
    setScrollToKeyId(undefined);
  };

  // Quick renew handlers
  const handleOpenQuickRenew = (user: UserDisplay) => {
    setQuickRenewUser({
      id: user.id,
      name: user.name,
      expiresAt: user.expiresAt ?? null,
      isEnabled: user.isEnabled,
    });
    setQuickRenewOpen(true);
  };

  const handleQuickRenewConfirm = async (
    userId: number,
    expiresAt: Date,
    enableUser?: boolean
  ): Promise<{ ok: boolean }> => {
    // 乐观更新：立即更新UI
    setOptimisticUserExpiries((prev) => {
      const next = new Map(prev);
      next.set(userId, expiresAt);
      return next;
    });

    try {
      const res = await renewUser(userId, { expiresAt: expiresAt.toISOString(), enableUser });
      if (!res.ok) {
        // 失败时回滚
        setOptimisticUserExpiries((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
        toast.error(res.error || tUserMgmt("quickRenew.failed"));
        return { ok: false };
      }
      toast.success(tUserMgmt("quickRenew.success"));
      // 刷新服务端数据（成功后乐观更新状态会在useEffect中被props覆盖）
      // 使 React Query 缓存失效，确保数据刷新
      queryClient.invalidateQueries({ queryKey: ["users"] });
      router.refresh();
      return { ok: true };
    } catch (error) {
      // 失败时回滚
      setOptimisticUserExpiries((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      console.error("[QuickRenew] failed", error);
      toast.error(tUserMgmt("quickRenew.failed"));
      return { ok: false };
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!showMultiSelect ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleToggleAll}
              disabled={users.length === 0}
            >
              {allExpanded ? translations.table.collapse : translations.table.expand}
            </Button>
          ) : null}

          {isAdmin &&
          onEnterMultiSelectMode &&
          onExitMultiSelectMode &&
          onSelectAll &&
          onOpenBatchEdit &&
          onSelectUser &&
          onSelectKey ? (
            <BatchEditToolbar
              isMultiSelectMode={showMultiSelect}
              allSelected={allSelected}
              selectedUsersCount={selectedUserIdSet.size}
              selectedKeysCount={selectedKeyIdSet.size}
              totalUsersCount={users.length}
              onEnterMode={onEnterMultiSelectMode}
              onExitMode={onExitMultiSelectMode}
              onSelectAll={onSelectAll}
              onEditSelected={onOpenBatchEdit}
            />
          ) : null}
        </div>
      </div>

      <div className={cn("border border-border rounded-lg", "overflow-hidden")}>
        <div className="relative w-full overflow-x-auto">
          <div className={MIN_TABLE_WIDTH_CLASS}>
            <div className="bg-muted/50 border-b">
              <div
                className={cn(
                  "grid items-center h-10 text-sm font-medium text-muted-foreground",
                  GRID_COLUMNS_CLASS
                )}
              >
                <div className="px-2 min-w-0">
                  <span
                    className="block truncate"
                    title={`${translations.table.columns.username} / ${translations.table.columns.note}`}
                  >
                    {translations.table.columns.username} / {translations.table.columns.note}
                  </span>
                </div>
                <div className="px-2 min-w-0">
                  <span className="block truncate" title={translations.table.columns.expiresAt}>
                    {translations.table.columns.expiresAt}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitRpm}>
                    {translations.table.columns.limitRpm}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limit5h}>
                    {translations.table.columns.limit5h}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitDaily}>
                    {translations.table.columns.limitDaily}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitWeekly}>
                    {translations.table.columns.limitWeekly}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitMonthly}>
                    {translations.table.columns.limitMonthly}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitTotal}>
                    {translations.table.columns.limitTotal}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.table.columns.limitSessions}>
                    {translations.table.columns.limitSessions}
                  </span>
                </div>
                <div className="px-2 text-center min-w-0">
                  <span className="block truncate" title={translations.actions.edit}>
                    {translations.actions.edit}
                  </span>
                </div>
              </div>
            </div>

            {users.length === 0 ? (
              <div className="py-16">
                <div className="flex flex-col items-center justify-center text-center">
                  <div className="mb-4 rounded-full bg-muted p-3">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="mb-2 text-lg font-medium">{tUserList("emptyState.title")}</h3>
                  <p className="mb-4 max-w-sm text-sm text-muted-foreground">
                    {tUserList("emptyState.description")}
                  </p>
                  {onCreateUser && (
                    <Button onClick={onCreateUser}>{tUserList("emptyState.action")}</Button>
                  )}
                </div>
              </div>
            ) : (
              <div ref={parentRef} className="h-[600px] overflow-y-auto">
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {virtualItems.map((virtualRow) => {
                    const isLoaderRow = virtualRow.index >= users.length;
                    const user = users[virtualRow.index];

                    if (isLoaderRow) {
                      return (
                        <div
                          key="loader"
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        />
                      );
                    }

                    if (!user) return null;

                    return (
                      <div
                        key={user.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <UserKeyTableRow
                          user={user}
                          isAdmin={isAdmin}
                          expanded={expandedUsers.get(user.id) ?? false}
                          onToggle={() => handleToggleUser(user.id)}
                          gridColumnsClass={GRID_COLUMNS_CLASS}
                          isMultiSelectMode={showMultiSelect}
                          isSelected={selectedUserIdSet.has(user.id)}
                          onSelect={
                            showMultiSelect && onSelectUser
                              ? (checked) => onSelectUser(user, checked)
                              : undefined
                          }
                          selectedKeyIds={selectedKeyIdSet}
                          onSelectKey={showMultiSelect ? onSelectKey : undefined}
                          onEditUser={(keyId) => openEditDialog(user.id, keyId)}
                          onQuickRenew={isAdmin ? handleOpenQuickRenew : undefined}
                          optimisticExpiresAt={optimisticUserExpiries.get(user.id)}
                          currentUser={currentUser}
                          currencyCode={currencyCode}
                          translations={rowTranslations}
                          highlightKeyIds={highlightKeyIds}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : null}

      {editingUser ? (
        <UnifiedEditDialog
          open={editDialogOpen}
          onOpenChange={handleEditDialogOpenChange}
          mode="edit"
          user={editingUser}
          scrollToKeyId={scrollToKeyId}
          keyOnlyMode={!isAdmin}
          currentUser={currentUser}
        />
      ) : null}

      {/* Quick renew dialog */}
      <QuickRenewDialog
        open={quickRenewOpen}
        onOpenChange={setQuickRenewOpen}
        user={quickRenewUser}
        onConfirm={handleQuickRenewConfirm}
        translations={quickRenewTranslations}
      />
    </div>
  );
}
