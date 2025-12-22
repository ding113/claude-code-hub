"use client";

import { ChevronDown, ChevronRight, SquarePen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { removeKey } from "@/actions/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date-format";
import type { UserDisplay } from "@/types/user";
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
  onEditUser: (scrollToKeyId?: number) => void;
  onQuickRenew?: (user: UserDisplay) => void;
  currentUser?: { role: string };
  currencyCode?: string;
  highlightKeyIds?: Set<number>;
  translations: {
    columns: {
      username: string;
      note: string;
      expiresAt: string;
      expiresAtHint?: string;
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
    };
    userStatus?: {
      disabled: string;
    };
  };
}

const DEFAULT_GRID_COLUMNS_CLASS = "grid-cols-[minmax(260px,1fr)_120px_repeat(6,90px)_60px]";

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
  onQuickRenew,
  currencyCode,
  highlightKeyIds,
  translations,
}: UserKeyTableRowProps) {
  const locale = useLocale();
  const tBatchEdit = useTranslations("dashboard.userManagement.batchEdit");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const isExpanded = isMultiSelectMode ? true : expanded;
  const resolvedGridColumnsClass = gridColumnsClass ?? DEFAULT_GRID_COLUMNS_CLASS;

  const keyRowTranslations = {
    ...(translations.keyRow ?? {}),
    defaultGroup: translations.defaultGroup,
  };

  const expiresText = formatExpiry(user.expiresAt ?? null, locale);

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
        toast.error(res.error || "删除失败");
        return;
      }
      toast.success("删除成功");
      router.refresh();
    });
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
            <span className="font-medium truncate">{user.name}</span>
            {!user.isEnabled && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {translations.userStatus?.disabled || "Disabled"}
              </Badge>
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
        <div className="px-2 flex items-center justify-center">
          {isAdmin ? (
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
          ) : null}
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
                    lastUsedAt: key.lastUsedAt,
                    expiresAt: key.expiresAt,
                    status: key.status,
                    modelStats: key.modelStats,
                  }}
                  userProviderGroup={user.providerGroup ?? null}
                  isMultiSelectMode={isMultiSelectMode}
                  isSelected={selectedKeyIds?.has(key.id) ?? false}
                  onSelect={(checked) => onSelectKey?.(key.id, checked)}
                  onEdit={() => onEditUser(key.id)}
                  onDelete={() => handleDeleteKey(key.id)}
                  onViewLogs={() => router.push(`/dashboard/logs?keyId=${key.id}`)}
                  onViewDetails={() => onEditUser(key.id)}
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
        </div>
      ) : null}
    </div>
  );
}
