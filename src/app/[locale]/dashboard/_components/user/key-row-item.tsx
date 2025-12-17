"use client";

import { Copy, Expand, Eye, EyeOff, FileText, Info, Pencil, Trash2 } from "lucide-react";
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
import { RelativeTime } from "@/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CURRENCY_CONFIG, type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { KeyFullDisplayDialog } from "./key-full-display-dialog";
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
  onEdit: () => void;
  onDelete: () => void;
  onViewLogs: () => void;
  onViewDetails: () => void;
  currencyCode?: string;
  translations: {
    fields: {
      name: string;
      key: string;
      group: string;
      todayUsage: string;
      todayCost: string;
      lastUsed: string;
      actions: string;
      callsLabel?: string;
      costLabel?: string;
    };
    actions: {
      details: string;
      logs: string;
      edit: string;
      delete: string;
      copy: string;
      show: string;
      hide: string;
      expand?: string;
    };
    status: {
      enabled: string;
      disabled: string;
    };
    defaultGroup: string;
  };
}

export function KeyRowItem({
  keyData,
  onEdit,
  onDelete,
  onViewLogs,
  onViewDetails,
  currencyCode,
  translations,
}: KeyRowItemProps) {
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullKeyDialogOpen, setFullKeyDialogOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);

  const resolvedCurrencyCode: CurrencyCode =
    currencyCode && currencyCode in CURRENCY_CONFIG ? (currencyCode as CurrencyCode) : "USD";

  const providerGroup = keyData.providerGroup?.trim()
    ? keyData.providerGroup
    : translations.defaultGroup;

  const canReveal = Boolean(keyData.fullKey);
  const canCopy = Boolean(keyData.canCopy && keyData.fullKey);
  const displayKey = isKeyVisible && keyData.fullKey ? keyData.fullKey : keyData.maskedKey || "-";

  const handleCopy = async () => {
    if (!canCopy || !keyData.fullKey) return;
    try {
      await navigator.clipboard.writeText(keyData.fullKey);
      toast.success(translations.actions.copy);
    } catch (error) {
      console.error("[KeyRowItem] copy failed", error);
      toast.error(translations.actions.copy);
    }
  };

  return (
    <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] items-center gap-3 px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/40 transition-colors">
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
            className={`min-w-0 flex-1 font-mono text-xs ${
              isKeyVisible && keyData.fullKey ? "select-all" : "truncate"
            }`}
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
                    aria-label={
                      isKeyVisible ? translations.actions.hide : translations.actions.show
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsKeyVisible((prev) => !prev);
                    }}
                    className="h-7 w-7"
                  >
                    {isKeyVisible ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isKeyVisible ? translations.actions.hide : translations.actions.show}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {keyData.fullKey ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={translations.actions.expand}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullKeyDialogOpen(true);
                    }}
                    className="h-7 w-7"
                  >
                    <Expand className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translations.actions.expand}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>

      {/* 分组 */}
      <div className="col-span-2 min-w-0">
        <div className="truncate text-muted-foreground" title={translations.fields.group}>
          {providerGroup}
        </div>
      </div>

      {/* 今日用量（调用次数） */}
      <div
        className="col-span-1 text-right tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayUsage}
      >
        <span className="text-xs text-muted-foreground">
          {translations.fields.callsLabel || "Calls"}:
        </span>
        <span>{Number(keyData.todayCallCount || 0).toLocaleString()}</span>
      </div>

      {/* 今日消耗（成本） */}
      <div
        className="col-span-2 text-right font-mono tabular-nums flex items-center justify-end gap-1"
        title={translations.fields.todayCost}
      >
        <span className="text-xs text-muted-foreground">
          {translations.fields.costLabel || "Cost"}:
        </span>
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
              <AlertDialogCancel>Cancel</AlertDialogCancel>
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
    </div>
  );
}
