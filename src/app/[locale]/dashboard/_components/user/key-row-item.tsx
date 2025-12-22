"use client";

import { BarChart3, Copy, Eye, FileText, Info, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CURRENCY_CONFIG, type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
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

function splitGroups(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

export function KeyRowItem({
  keyData,
  userProviderGroup,
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullKeyDialogOpen, setFullKeyDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const tCommon = useTranslations("common");
  const tBatchEdit = useTranslations("dashboard.userManagement.batchEdit");

  const resolvedCurrencyCode: CurrencyCode =
    currencyCode && currencyCode in CURRENCY_CONFIG ? (currencyCode as CurrencyCode) : "USD";

  const keyGroups = splitGroups(keyData.providerGroup);
  const inheritedGroups = splitGroups(userProviderGroup);
  const isInherited = keyGroups.length === 0;
  const effectiveGroups = isInherited ? inheritedGroups : keyGroups;
  const visibleGroups = effectiveGroups.slice(0, 2);
  const remainingGroups = Math.max(0, effectiveGroups.length - visibleGroups.length);
  const effectiveGroupText =
    effectiveGroups.length > 0 ? effectiveGroups.join(", ") : translations.defaultGroup;

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

  return (
    <div
      className={cn(
        "grid items-center gap-3 px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/40 transition-colors",
        isMultiSelectMode
          ? "grid-cols-[24px_repeat(14,minmax(0,1fr))]"
          : "grid-cols-[repeat(14,minmax(0,1fr))]",
        highlight && "bg-primary/10 ring-1 ring-primary/30"
      )}
    >
      {isMultiSelectMode ? (
        <div className="col-span-1 flex items-center justify-center">
          <Checkbox
            aria-label={tBatchEdit("aria.selectKey")}
            checked={Boolean(isSelected)}
            onCheckedChange={(checked) => onSelect?.(Boolean(checked))}
          />
        </div>
      ) : null}

      {/* 名称 */}
      <div className="col-span-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="truncate font-medium">{keyData.name}</div>
          <Badge
            variant={keyData.status === "enabled" ? "default" : "secondary"}
            className="text-[10px]"
          >
            {keyData.status === "enabled"
              ? translations.status.enabled
              : translations.status.disabled}
          </Badge>
        </div>
      </div>

      {/* 密钥 */}
      <div className="col-span-3 min-w-0">
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
      <div className="col-span-2 min-w-0">
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
                        variant={isInherited ? "secondary" : "outline"}
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
        className="col-span-1 text-right tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayUsage}
      >
        <span className="text-xs text-muted-foreground">{translations.fields.callsLabel}:</span>
        <span>{Number(keyData.todayCallCount || 0).toLocaleString()}</span>
      </div>

      {/* 今日消耗（成本） */}
      <div
        className="col-span-2 text-right font-mono tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayCost}
      >
        <span className="text-xs text-muted-foreground">{translations.fields.costLabel}:</span>
        <span>{formatCurrency(keyData.todayUsage || 0, resolvedCurrencyCode)}</span>
      </div>

      {/* 最后使用 */}
      <div className="col-span-2 min-w-0" title={translations.fields.lastUsed}>
        {keyData.lastUsedAt ? (
          <RelativeTime date={keyData.lastUsedAt} autoUpdate={false} />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>

      {/* 操作 */}
      <div
        className="col-span-2 flex items-center justify-end gap-1"
        title={translations.fields.actions}
      >
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
    </div>
  );
}
