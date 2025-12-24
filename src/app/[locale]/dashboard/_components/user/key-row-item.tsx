"use client";

import { BarChart3, Copy, Eye, FileText, Info, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { renewKeyExpiresAt, toggleKeyEnabled } from "@/actions/keys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RelativeTime } from "@/components/ui/relative-time";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CURRENCY_CONFIG, type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/date-format";
import { type QuickRenewKey, QuickRenewKeyDialog } from "./forms/quick-renew-key-dialog";
import { KeyFullDisplayDialog } from "./key-full-display-dialog";
import { KeyQuotaUsageDialog } from "./key-quota-usage-dialog";
import { KeyStatsDialog } from "./key-stats-dialog";

export interface KeyRowItemProps {
  keyData: {
    id: number;
    name: string;
    maskedKey: string;
    fullKey?: string;
    canCopy: boolean;
    providerGroup?: string | null;
    todayUsage: number;
    todayCallCount: number;
    lastUsedAt: Date | null;
    expiresAt: string;
    status: "enabled" | "disabled";
    modelStats: Array<{
      model: string;
      callCount: number;
      totalCost: number;
    }>;
  };
  /** User-level provider groups (used when key inherits providerGroup). */
  userProviderGroup?: string | null;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewLogs: () => void;
  onViewDetails: () => void;
  currencyCode?: string;
  highlight?: boolean;
  translations: {
    fields: {
      name: string;
      key: string;
      group: string;
      todayUsage: string;
      todayCost: string;
      lastUsed: string;
      actions: string;
      callsLabel: string;
      costLabel: string;
    };
    actions: {
      details: string;
      logs: string;
      edit: string;
      delete: string;
      copy: string;
      copySuccess: string;
      copyFailed: string;
      show: string;
      hide: string;
      quota: string;
    };
    status: {
      enabled: string;
      disabled: string;
    };
    defaultGroup: string;
  };
}

const EXPIRING_SOON_MS = 72 * 60 * 60 * 1000; // 72小时

function splitGroups(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

function formatExpiry(expiresAt: string | null | undefined, locale: string): string {
  if (!expiresAt) return "-";
  const date = new Date(expiresAt);
  // 如果解析失败（如"永不过期"等翻译文本），直接返回原文本
  if (Number.isNaN(date.getTime())) return expiresAt;
  return formatDate(date, "yyyy-MM-dd", locale);
}

function getKeyExpiryStatus(
  status: "enabled" | "disabled",
  expiresAt: string | null | undefined
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (status === "disabled") return { label: "disabled", variant: "secondary" };
  if (!expiresAt) return { label: "active", variant: "default" };

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return { label: "active", variant: "default" };

  const now = Date.now();
  const expTs = date.getTime();

  if (expTs <= now) return { label: "expired", variant: "destructive" };
  if (expTs - now <= EXPIRING_SOON_MS) return { label: "expiringSoon", variant: "outline" };
  return { label: "active", variant: "default" };
}

export function KeyRowItem({
  keyData,
  userProviderGroup: _userProviderGroup,
  isMultiSelectMode,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onViewLogs,
  onViewDetails: _onViewDetails,
  currencyCode,
  highlight,
  translations,
}: KeyRowItemProps) {
  const locale = useLocale();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullKeyDialogOpen, setFullKeyDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const [quickRenewOpen, setQuickRenewOpen] = useState(false);
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);
  // 乐观更新：本地状态跟踪启用状态
  const [localStatus, setLocalStatus] = useState<"enabled" | "disabled">(keyData.status);
  // 乐观更新：本地状态跟踪过期时间
  const [localExpiresAt, setLocalExpiresAt] = useState<string | null | undefined>(
    keyData.expiresAt
  );
  const tCommon = useTranslations("common");
  const tBatchEdit = useTranslations("dashboard.userManagement.batchEdit");
  const tKeyRenew = useTranslations("dashboard.userManagement.quickRenew");
  const tKeyStatus = useTranslations("dashboard.userManagement.keyStatus");

  // 当props更新时同步本地状态
  useEffect(() => {
    setLocalStatus(keyData.status);
  }, [keyData.status]);

  // 当props更新时同步过期时间
  useEffect(() => {
    setLocalExpiresAt(keyData.expiresAt);
  }, [keyData.expiresAt]);

  const resolvedCurrencyCode: CurrencyCode =
    currencyCode && currencyCode in CURRENCY_CONFIG ? (currencyCode as CurrencyCode) : "USD";

  const keyGroups = splitGroups(keyData.providerGroup);
  const effectiveGroups = keyGroups.length > 0 ? keyGroups : [translations.defaultGroup];
  const visibleGroups = effectiveGroups.slice(0, 1);

  // 计算 key 过期状态
  const keyExpiryStatus = getKeyExpiryStatus(localStatus, localExpiresAt);
  const remainingGroups = Math.max(0, effectiveGroups.length - visibleGroups.length);
  const effectiveGroupText = effectiveGroups.join(", ");

  const canReveal = Boolean(keyData.fullKey);
  const canCopy = Boolean(keyData.canCopy && keyData.fullKey);
  const displayKey = keyData.maskedKey || "-";

  const handleCopy = async () => {
    if (!canCopy || !keyData.fullKey) return;
    try {
      await navigator.clipboard.writeText(keyData.fullKey);
      toast.success(translations.actions.copySuccess);
    } catch (error) {
      console.error("[KeyRowItem] copy failed", error);
      toast.error(translations.actions.copyFailed);
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    // 乐观更新：立即更新UI
    const newStatus: "enabled" | "disabled" = checked ? "enabled" : "disabled";
    setLocalStatus(newStatus);
    setIsTogglingEnabled(true);

    try {
      const res = await toggleKeyEnabled(keyData.id, checked);
      if (!res.ok) {
        // 失败时回滚UI状态
        setLocalStatus(checked ? "disabled" : "enabled");
        toast.error(res.error || tKeyStatus("operationFailed"));
        setIsTogglingEnabled(false);
        return;
      }
      toast.success(checked ? tKeyStatus("keyEnabled") : tKeyStatus("keyDisabled"));
      // 刷新服务端数据
      router.refresh();
    } catch (error) {
      // 失败时回滚UI状态
      setLocalStatus(checked ? "disabled" : "enabled");
      console.error("[KeyRowItem] toggle key enabled failed", error);
      toast.error(tKeyStatus("operationFailed"));
    } finally {
      setIsTogglingEnabled(false);
    }
  };

  const handleQuickRenewConfirm = async (
    _keyId: number,
    expiresAt: Date,
    enableKey?: boolean
  ): Promise<{ ok: boolean }> => {
    // 乐观更新：立即更新UI
    const newExpiresAt = expiresAt.toISOString();
    setLocalExpiresAt(newExpiresAt);
    if (enableKey !== undefined) {
      setLocalStatus(enableKey ? "enabled" : "disabled");
    }

    try {
      // 使用专用的续期 action，避免 editKey 覆盖其他字段
      const res = await renewKeyExpiresAt(keyData.id, {
        expiresAt: newExpiresAt,
        enableKey,
      });
      if (!res.ok) {
        // 失败时回滚UI状态
        setLocalExpiresAt(keyData.expiresAt);
        if (enableKey !== undefined) {
          setLocalStatus(keyData.status);
        }
        toast.error(res.error || tKeyRenew("failed"));
        return { ok: false };
      }
      toast.success(tKeyRenew("success"));
      router.refresh();
      return { ok: true };
    } catch (error) {
      // 失败时回滚UI状态
      setLocalExpiresAt(keyData.expiresAt);
      if (enableKey !== undefined) {
        setLocalStatus(keyData.status);
      }
      console.error("[KeyRowItem] quick renew failed", error);
      toast.error(tKeyRenew("failed"));
      return { ok: false };
    }
  };

  const quickRenewKeyData: QuickRenewKey = {
    id: keyData.id,
    name: keyData.name,
    expiresAt: localExpiresAt, // 使用本地状态
    status: localStatus,
  };

  const quickRenewTranslations = {
    title: tKeyRenew("title"),
    description: tKeyRenew("description", { userName: keyData.name }),
    currentExpiry: tKeyRenew("currentExpiry"),
    neverExpires: tKeyRenew("neverExpires"),
    expired: tKeyRenew("expired"),
    quickExtensionLabel: tKeyRenew("quickExtensionLabel"),
    quickExtensionHint: tKeyRenew("quickExtensionHint"),
    customDateLabel: tKeyRenew("customDateLabel"),
    customDateHint: tKeyRenew("customDateHint"),
    quickOptions: {
      "7days": tKeyRenew("quickOptions.7days"),
      "30days": tKeyRenew("quickOptions.30days"),
      "90days": tKeyRenew("quickOptions.90days"),
      "1year": tKeyRenew("quickOptions.1year"),
    },
    customDate: tKeyRenew("customDate"),
    enableOnRenew: tKeyRenew("enableKeyOnRenew"),
    cancel: tKeyRenew("cancel"),
    confirm: tKeyRenew("confirm"),
    confirming: tKeyRenew("confirming"),
  };

  return (
    <div
      className={cn(
        "grid items-center gap-3 px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/40 transition-colors",
        isMultiSelectMode
          ? "grid-cols-[24px_2fr_3fr_3fr_1fr_2fr_1.5fr_1.5fr_1.5fr]"
          : "grid-cols-[2fr_3fr_2.5fr_1fr_2fr_1.5fr_1.5fr_1.5fr]",
        highlight && "bg-primary/10 ring-1 ring-primary/30"
      )}
    >
      {isMultiSelectMode ? (
        <div className="flex items-center justify-center">
          <Checkbox
            aria-label={tBatchEdit("aria.selectKey")}
            checked={Boolean(isSelected)}
            onCheckedChange={(checked) => onSelect?.(Boolean(checked))}
          />
        </div>
      ) : null}

      {/* 名称 */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="truncate font-medium">{keyData.name}</div>
          <Badge variant={keyExpiryStatus.variant} className="text-[10px] shrink-0">
            {tKeyStatus(keyExpiryStatus.label)}
          </Badge>
        </div>
      </div>

      {/* 密钥 */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="min-w-0 flex-1 font-mono text-xs truncate"
            title={translations.fields.key}
          >
            {displayKey}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canCopy ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={translations.actions.copy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopy();
                    }}
                    className="h-7 w-7"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translations.actions.copy}</TooltipContent>
              </Tooltip>
            ) : null}

            {canReveal ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={translations.actions.show}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullKeyDialogOpen(true);
                    }}
                    className="h-7 w-7"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translations.actions.show}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>

      {/* 分组 */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0">
            {translations.fields.group}:
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 min-w-0 overflow-hidden cursor-help">
                {visibleGroups.length > 0 ? (
                  <>
                    {visibleGroups.map((group) => (
                      <Badge
                        key={group}
                        variant="outline"
                        className="text-xs font-mono max-w-[120px] truncate"
                        title={group}
                      >
                        {group}
                      </Badge>
                    ))}
                    {remainingGroups > 0 ? (
                      <Badge
                        variant="outline"
                        className="text-xs font-mono shrink-0"
                        title={effectiveGroupText}
                      >
                        +{remainingGroups}
                      </Badge>
                    ) : null}
                  </>
                ) : (
                  <Badge variant="outline" className="text-xs font-mono max-w-[160px] truncate">
                    {translations.defaultGroup}
                  </Badge>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-[420px]">
              <p className="text-xs whitespace-normal break-words font-mono">
                {effectiveGroupText}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 今日用量（调用次数） */}
      <div
        className="text-right tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayUsage}
      >
        <span className="text-xs text-muted-foreground">{translations.fields.callsLabel}:</span>
        <span>{Number(keyData.todayCallCount || 0).toLocaleString()}</span>
      </div>

      {/* 今日消耗（成本） */}
      <div
        className="text-right font-mono tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayCost}
      >
        <span className="text-xs text-muted-foreground">{translations.fields.costLabel}:</span>
        <span>{formatCurrency(keyData.todayUsage || 0, resolvedCurrencyCode)}</span>
      </div>

      {/* 最后使用 */}
      <div className="min-w-0" title={translations.fields.lastUsed}>
        {keyData.lastUsedAt ? (
          <RelativeTime date={keyData.lastUsedAt} autoUpdate={false} />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>

      {/* 过期时间 - clickable for quick renew */}
      <div
        className="min-w-0 text-sm text-muted-foreground cursor-pointer hover:text-primary hover:underline"
        title={tKeyStatus("clickToQuickRenew")}
        onClick={(e) => {
          e.stopPropagation();
          setQuickRenewOpen(true);
        }}
      >
        {formatExpiry(localExpiresAt, locale)}
      </div>

      {/* 操作 */}
      <div className="flex items-center justify-end gap-1" title={translations.fields.actions}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              <Switch
                checked={localStatus === "enabled"}
                onCheckedChange={handleToggleEnabled}
                disabled={isTogglingEnabled}
                aria-label={tKeyStatus("toggleKeyStatus")}
                className="scale-75"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {localStatus === "enabled"
              ? tKeyStatus("clickToDisableKey")
              : tKeyStatus("clickToEnableKey")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={translations.actions.details}
              onClick={(e) => {
                e.stopPropagation();
                setStatsDialogOpen(true);
              }}
              className="h-7 w-7"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translations.actions.details}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={translations.actions.quota}
              onClick={(e) => {
                e.stopPropagation();
                setQuotaDialogOpen(true);
              }}
              className="h-7 w-7"
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translations.actions.quota}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={translations.actions.logs}
              onClick={(e) => {
                e.stopPropagation();
                onViewLogs();
              }}
              className="h-7 w-7"
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translations.actions.logs}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={translations.actions.edit}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="h-7 w-7"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translations.actions.edit}</TooltipContent>
        </Tooltip>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={translations.actions.delete}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteOpen(true);
                }}
                className="h-7 w-7 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translations.actions.delete}</TooltipContent>
          </Tooltip>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{translations.actions.delete}</AlertDialogTitle>
              <AlertDialogDescription>
                {translations.fields.name}: {keyData.name}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteOpen(false);
                  onDelete();
                }}
                className={buttonVariants({ variant: "destructive" })}
              >
                {translations.actions.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Full Key Display Dialog */}
      {keyData.fullKey && (
        <KeyFullDisplayDialog
          open={fullKeyDialogOpen}
          onOpenChange={setFullKeyDialogOpen}
          keyName={keyData.name}
          fullKey={keyData.fullKey}
        />
      )}

      {/* Model Stats Dialog */}
      <KeyStatsDialog
        open={statsDialogOpen}
        onOpenChange={setStatsDialogOpen}
        keyName={keyData.name}
        modelStats={keyData.modelStats}
        currencyCode={currencyCode}
      />

      {/* Key Quota Usage Dialog */}
      <KeyQuotaUsageDialog
        open={quotaDialogOpen}
        onOpenChange={setQuotaDialogOpen}
        keyId={keyData.id}
        keyName={keyData.name}
        currencyCode={resolvedCurrencyCode}
      />

      {/* Quick Renew Key Dialog */}
      <QuickRenewKeyDialog
        open={quickRenewOpen}
        onOpenChange={setQuickRenewOpen}
        keyData={quickRenewKeyData}
        onConfirm={handleQuickRenewConfirm}
        translations={quickRenewTranslations}
      />
    </div>
  );
}
