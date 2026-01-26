"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Clock,
  Plus,
  SquarePen,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeKey } from "@/actions/keys";
import { toggleUserEnabled } from "@/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { getContrastTextColor, getGroupColor } from "@/lib/utils/color";
import { formatDate } from "@/lib/utils/date-format";
import type { UserDisplay } from "@/types/user";
import { EditKeyDialog } from "./edit-key-dialog";
import { KeyRowItem } from "./key-row-item";
import { UserLimitBadge } from "./user-limit-badge";

export interface UserKeyTableRowProps {
  user: UserDisplay; // 包含 keys 数组
  isAdmin: boolean;
  expanded: boolean;
  onToggle: () => void;
  gridColumnsClass?: string;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (checked: boolean) => void;
  selectedKeyIds?: Set<number>;
  onSelectKey?: (keyId: number, checked: boolean) => void;
  onEditUser: () => void;
  onAddKey?: () => void;
  onQuickRenew?: (user: UserDisplay) => void;
  optimisticExpiresAt?: Date;
  currentUser?: { role: string };
  currencyCode?: string;
  highlightKeyIds?: Set<number>;
  translations: {
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
    actions: {
      edit: string;
      details: string;
      logs: string;
      delete: string;
      addKey?: string;
    };
    userStatus?: {
      disabled: string;
    };
  };
}

const DEFAULT_GRID_COLUMNS_CLASS = "grid-cols-[minmax(260px,1fr)_120px_repeat(7,90px)_80px]";
const EXPIRING_SOON_MS = 72 * 60 * 60 * 1000; // 72小时
const MAX_VISIBLE_GROUPS = 2; // 最多显示的分组数量

function splitGroups(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

function getExpiryStatus(
  isEnabled: boolean,
  expiresAt: Date | null | undefined
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const now = Date.now();
  const expTs = expiresAt?.getTime();
  const hasExpiry = typeof expTs === "number" && Number.isFinite(expTs);

  if (!isEnabled) return { label: "disabled", variant: "secondary" };
  if (hasExpiry && expTs <= now) return { label: "expired", variant: "destructive" };
  if (hasExpiry && expTs - now <= EXPIRING_SOON_MS)
    return { label: "expiringSoon", variant: "outline" };
  return { label: "active", variant: "default" };
}

// Calculate days left until expiry (for user mode badge)
function getDaysLeft(expiresAt: Date | null | undefined): number | null {
  if (!expiresAt) return null;
  const now = Date.now();
  const expTs = expiresAt.getTime();
  if (!Number.isFinite(expTs) || expTs <= now) return null;
  const msLeft = expTs - now;
  return Math.ceil(msLeft / (1000 * 60 * 60 * 24));
}

function normalizeLimitValue(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function formatExpiry(expiresAt: UserDisplay["expiresAt"], locale: string): string {
  if (!expiresAt) return "-";
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDate(date, "yyyy-MM-dd", locale);
}

export function UserKeyTableRow({
  user,
  isAdmin,
  expanded,
  onToggle,
  gridColumnsClass,
  isMultiSelectMode,
  isSelected,
  onSelect,
  selectedKeyIds,
  onSelectKey,
  onEditUser,
  onAddKey,
  onQuickRenew,
  optimisticExpiresAt,
  currencyCode,
  highlightKeyIds,
  translations,
}: UserKeyTableRowProps) {
  const locale = useLocale();
  const tBatchEdit = useTranslations("dashboard.userManagement.batchEdit");
  const tUserStatus = useTranslations("dashboard.userManagement.userStatus");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [_isPending, startTransition] = useTransition();
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);
  // 乐观更新：本地状态跟踪启用状态
  const [localIsEnabled, setLocalIsEnabled] = useState(user.isEnabled);
  // 乐观更新：本地状态跟踪过期时间
  const [localExpiresAt, setLocalExpiresAt] = useState<Date | null | undefined>(user.expiresAt);
  // Key 编辑 Dialog 状态
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const isExpanded = isMultiSelectMode ? true : expanded;
  const resolvedGridColumnsClass = gridColumnsClass ?? DEFAULT_GRID_COLUMNS_CLASS;

  // 当props更新时同步本地状态
  useEffect(() => {
    setLocalIsEnabled(user.isEnabled);
  }, [user.isEnabled]);

  // 同步过期时间状态：优先使用乐观更新值，否则使用服务端数据
  // 修复：当 optimisticExpiresAt 变为 undefined 时也能正确回滚到 user.expiresAt
  useEffect(() => {
    setLocalExpiresAt(optimisticExpiresAt ?? user.expiresAt);
  }, [optimisticExpiresAt, user.expiresAt]);

  const keyRowTranslations = {
    ...(translations.keyRow ?? {}),
    defaultGroup: translations.defaultGroup,
  };

  const expiresText = formatExpiry(localExpiresAt ?? null, locale);

  // 计算用户过期状态
  const expiryStatus = getExpiryStatus(localIsEnabled, localExpiresAt ?? null);

  // 计算剩余天数（仅用于 user mode 显示）
  const daysLeft = useMemo(() => getDaysLeft(localExpiresAt ?? null), [localExpiresAt]);
  const showExpiryBadge = !isAdmin && daysLeft !== null && daysLeft <= 7;

  // 处理 Provider Group：拆分成数组
  const userGroups = splitGroups(user.providerGroup);
  const visibleGroups = userGroups.slice(0, MAX_VISIBLE_GROUPS);
  const remainingGroupsCount = Math.max(0, userGroups.length - MAX_VISIBLE_GROUPS);

  // RPM: null 或 0 或负值表示无限制
  const rpm = user.rpm !== null && user.rpm > 0 ? user.rpm : null;
  const limit5h = normalizeLimitValue(user.limit5hUsd);
  const limitDaily = normalizeLimitValue(user.dailyQuota);
  const limitWeekly = normalizeLimitValue(user.limitWeeklyUsd);
  const limitMonthly = normalizeLimitValue(user.limitMonthlyUsd);
  const limitTotal = normalizeLimitValue(user.limitTotalUsd);
  const limitSessions = normalizeLimitValue(user.limitConcurrentSessions);

  const handleDeleteKey = (keyId: number) => {
    startTransition(async () => {
      const res = await removeKey(keyId);
      if (!res.ok) {
        toast.error(res.error || tUserStatus("deleteFailed"));
        return;
      }
      toast.success(tUserStatus("deleteSuccess"));
      // 使 React Query 缓存失效，确保数据刷新
      queryClient.invalidateQueries({ queryKey: ["users"] });
      router.refresh();
    });
  };

  const handleToggleUserEnabled = async (checked: boolean) => {
    // 乐观更新：立即更新UI
    setLocalIsEnabled(checked);
    setIsTogglingEnabled(true);

    try {
      const res = await toggleUserEnabled(user.id, checked);
      if (!res.ok) {
        // 失败时回滚UI状态
        setLocalIsEnabled(!checked);
        toast.error(res.error || tUserStatus("operationFailed"));
        setIsTogglingEnabled(false);
        return;
      }
      toast.success(checked ? tUserStatus("userEnabled") : tUserStatus("userDisabled"));
      // 使 React Query 缓存失效，确保数据刷新
      queryClient.invalidateQueries({ queryKey: ["users"] });
      // 刷新服务端数据
      router.refresh();
    } catch (error) {
      // 失败时回滚UI状态
      setLocalIsEnabled(!checked);
      console.error("[UserKeyTableRow] toggle user enabled failed", error);
      toast.error(tUserStatus("operationFailed"));
    } finally {
      setIsTogglingEnabled(false);
    }
  };

  return (
    <div className="border-b">
      <div
        className={cn(
          "grid items-center h-[52px] text-sm",
          resolvedGridColumnsClass,
          !isMultiSelectMode && "cursor-pointer hover:bg-muted/50"
        )}
        onClick={() => {
          if (isMultiSelectMode) return;
          onToggle();
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          if (isMultiSelectMode) return;
          e.preventDefault();
          onToggle();
        }}
      >
        {/* 用户名 / 备注 */}
        <div className="px-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {isMultiSelectMode ? (
              <div
                className="flex items-center"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Checkbox
                  aria-label={tBatchEdit("aria.selectUser")}
                  checked={Boolean(isSelected)}
                  onCheckedChange={(checked) => onSelect?.(Boolean(checked))}
                />
              </div>
            ) : null}
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="sr-only">
              {isExpanded ? translations.collapse : translations.expand}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 cursor-help">
                  {expiryStatus.label === "active" && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {expiryStatus.label === "disabled" && (
                    <CircleOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  {expiryStatus.label === "expiringSoon" && (
                    <Clock className="h-4 w-4 text-yellow-500" />
                  )}
                  {expiryStatus.label === "expired" && (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>{tUserStatus(expiryStatus.label)}</TooltipContent>
            </Tooltip>
            <span className="font-medium truncate">{user.name}</span>
            {userGroups.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 cursor-help">
                    {visibleGroups.map((group) => {
                      if (group.toLowerCase() === "default") {
                        return (
                          <Badge key={group} variant="outline" className="text-[10px] shrink-0">
                            {group}
                          </Badge>
                        );
                      }
                      const bgColor = getGroupColor(group);
                      return (
                        <Badge
                          key={group}
                          className="text-[10px] shrink-0"
                          style={{
                            backgroundColor: bgColor,
                            color: getContrastTextColor(bgColor),
                          }}
                        >
                          {group}
                        </Badge>
                      );
                    })}
                    {remainingGroupsCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        +{remainingGroupsCount}
                      </Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start">
                  <div className="max-w-xs">
                    <p className="font-medium mb-1">{translations.keyRow?.fields?.group}:</p>
                    <ul className="text-xs list-disc list-inside">
                      {userGroups.map((group) => (
                        <li key={group}>{group}</li>
                      ))}
                    </ul>
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : null}
            {user.tags && user.tags.length > 0 && (
              <span className="text-xs text-muted-foreground truncate">
                [{user.tags.join(", ")}]
              </span>
            )}
            {user.note ? (
              <span className="text-xs text-muted-foreground truncate">{user.note}</span>
            ) : null}
          </div>
        </div>

        {/* 到期时间 - clickable for quick renew */}
        <div
          className={cn(
            "px-2 text-sm text-muted-foreground",
            onQuickRenew && "cursor-pointer hover:text-primary hover:underline"
          )}
          onClick={(e) => {
            if (onQuickRenew) {
              e.stopPropagation();
              onQuickRenew(user);
            }
          }}
          title={onQuickRenew ? translations.columns.expiresAtHint : undefined}
        >
          {expiresText}
        </div>

        {/* RPM 限额 */}
        <div className="px-2 flex items-center justify-center">
          <Badge
            variant={rpm ? "secondary" : "outline"}
            className="px-2 py-0.5 tabular-nums text-xs"
            title={`${translations.columns.limitRpm}: ${rpm ?? "-"}`}
            aria-label={`${translations.columns.limitRpm}: ${rpm ?? "-"}`}
          >
            {rpm ?? "-"}
          </Badge>
        </div>

        {/* 5h 限额 */}
        <div className="px-2 flex items-center justify-center">
          <UserLimitBadge
            userId={user.id}
            limitType="5h"
            limit={limit5h}
            label={translations.columns.limit5h}
          />
        </div>

        {/* 每日限额 */}
        <div className="px-2 flex items-center justify-center">
          <UserLimitBadge
            userId={user.id}
            limitType="daily"
            limit={limitDaily}
            label={translations.columns.limitDaily}
          />
        </div>

        {/* 周限额 */}
        <div className="px-2 flex items-center justify-center">
          <UserLimitBadge
            userId={user.id}
            limitType="weekly"
            limit={limitWeekly}
            label={translations.columns.limitWeekly}
          />
        </div>

        {/* 月限额 */}
        <div className="px-2 flex items-center justify-center">
          <UserLimitBadge
            userId={user.id}
            limitType="monthly"
            limit={limitMonthly}
            label={translations.columns.limitMonthly}
          />
        </div>

        {/* 总限额 */}
        <div className="px-2 flex items-center justify-center">
          <UserLimitBadge
            userId={user.id}
            limitType="total"
            limit={limitTotal}
            label={translations.columns.limitTotal}
          />
        </div>

        {/* 并发限额 */}
        <div className="px-2 flex items-center justify-center">
          <Badge
            variant={limitSessions ? "secondary" : "outline"}
            className="px-2 py-0.5 tabular-nums text-xs"
            title={`${translations.columns.limitSessions}: ${limitSessions ?? "-"}`}
            aria-label={`${translations.columns.limitSessions}: ${limitSessions ?? "-"}`}
          >
            {limitSessions ?? "-"}
          </Badge>
        </div>

        {/* 操作 */}
        <div className="px-2 flex items-center justify-center gap-2">
          {isAdmin ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex items-center"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={localIsEnabled}
                      onCheckedChange={handleToggleUserEnabled}
                      disabled={isTogglingEnabled}
                      aria-label={tUserStatus("toggleUserStatus")}
                      className="scale-90"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {localIsEnabled
                    ? tUserStatus("clickToDisableUser")
                    : tUserStatus("clickToEnableUser")}
                </TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={translations.actions.edit}
                title={translations.actions.edit}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditUser();
                }}
              >
                <SquarePen className="h-4 w-4" />
              </Button>
            </>
          ) : (
            showExpiryBadge && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant={daysLeft === 0 ? "destructive" : "outline"}
                    className={cn(
                      "text-xs cursor-help",
                      daysLeft > 0 &&
                        daysLeft <= 7 &&
                        "border-amber-500 text-amber-600 dark:text-amber-400"
                    )}
                  >
                    <Clock className="h-3 w-3 mr-1" />
                    {daysLeft}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{tUserStatus("daysLeft", { days: daysLeft })}</TooltipContent>
              </Tooltip>
            )
          )}
        </div>
      </div>

      {isExpanded ? (
        <div className="bg-muted px-3 py-3">
          {user.keys.length > 0 ? (
            <div className="overflow-hidden rounded-md border bg-background">
              {user.keys.map((key) => (
                <KeyRowItem
                  key={key.id}
                  keyData={{
                    id: key.id,
                    name: key.name,
                    maskedKey: key.maskedKey,
                    fullKey: key.fullKey,
                    canCopy: key.canCopy,
                    providerGroup: key.providerGroup,
                    todayUsage: key.todayUsage,
                    todayCallCount: key.todayCallCount,
                    todayTokens: key.todayTokens,
                    lastUsedAt: key.lastUsedAt,
                    expiresAt: key.expiresAt,
                    status: key.status,
                    modelStats: key.modelStats,
                  }}
                  userProviderGroup={user.providerGroup ?? null}
                  isMultiSelectMode={isMultiSelectMode}
                  isSelected={selectedKeyIds?.has(key.id) ?? false}
                  onSelect={(checked) => onSelectKey?.(key.id, checked)}
                  onEdit={() => setEditingKeyId(key.id)}
                  onDelete={() => handleDeleteKey(key.id)}
                  onViewLogs={() => router.push(`/dashboard/logs?keyId=${key.id}`)}
                  onViewDetails={() => setEditingKeyId(key.id)}
                  currencyCode={currencyCode}
                  translations={keyRowTranslations}
                  highlight={highlightKeyIds?.has(key.id)}
                />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {translations.noKeys}
            </div>
          )}
          {onAddKey && (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddKey();
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {translations.actions.addKey}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Key 编辑 Dialog */}
      {editingKeyId !== null &&
        (() => {
          const editingKey = user.keys.find((k) => k.id === editingKeyId);
          if (!editingKey) return null;
          return (
            <EditKeyDialog
              open={true}
              onOpenChange={(open) => {
                if (!open) setEditingKeyId(null);
              }}
              keyData={{
                id: editingKey.id,
                name: editingKey.name,
                expiresAt: editingKey.expiresAt,
                canLoginWebUi: editingKey.canLoginWebUi,
                providerGroup: editingKey.providerGroup ?? null,
                limit5hUsd: editingKey.limit5hUsd,
                limitDailyUsd: editingKey.limitDailyUsd,
                dailyResetMode: editingKey.dailyResetMode,
                dailyResetTime: editingKey.dailyResetTime,
                limitWeeklyUsd: editingKey.limitWeeklyUsd,
                limitMonthlyUsd: editingKey.limitMonthlyUsd,
                limitTotalUsd: editingKey.limitTotalUsd,
                limitConcurrentSessions: editingKey.limitConcurrentSessions,
              }}
              user={{
                id: user.id,
                providerGroup: user.providerGroup ?? null,
                limit5hUsd: user.limit5hUsd ?? undefined,
                limitWeeklyUsd: user.limitWeeklyUsd ?? undefined,
                limitMonthlyUsd: user.limitMonthlyUsd ?? undefined,
                limitTotalUsd: user.limitTotalUsd ?? undefined,
                limitConcurrentSessions: user.limitConcurrentSessions ?? undefined,
              }}
              isAdmin={isAdmin}
              onSuccess={() => {
                setEditingKeyId(null);
                queryClient.invalidateQueries({ queryKey: ["users"] });
                router.refresh();
              }}
            />
          );
        })()}
    </div>
  );
}
