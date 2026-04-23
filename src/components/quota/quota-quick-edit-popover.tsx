"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { type CurrencyCode, formatCurrency, getCurrencySymbol } from "@/lib/utils/currency";

export type QuickEditMode = "set" | "add";
export type QuickEditUnit = "currency" | "integer";

/** 解析输入串为合法数值（整数模式下只接受整数） */
export function parseQuickEditDraft(
  draft: string,
  unit: QuickEditUnit
): number | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (unit === "integer" && !Number.isInteger(n)) return null;
  return n;
}

/** 根据当前限额、输入和模式计算最终限额（null = 无限额） */
export function computeQuickEditLimit(
  mode: QuickEditMode,
  draft: string,
  currentLimit: number | null,
  unit: QuickEditUnit,
  allowClear: boolean
): number | null {
  const parsed = parseQuickEditDraft(draft, unit);
  if (mode === "add") {
    if (parsed == null) return null;
    return (currentLimit ?? 0) + parsed;
  }
  // set 模式
  if (draft.trim().length === 0) return null;
  if (parsed == null) return null;
  if (allowClear && parsed === 0) return null;
  return parsed;
}

export interface QuotaQuickEditPopoverProps {
  /** 当前限额值，null 表示未设置 */
  currentLimit: number | null;
  /** 字段人类可读名称，如「5小时限额」 */
  label: string;
  /** 数值类型 */
  unit?: QuickEditUnit;
  /** unit=currency 时使用 */
  currencyCode?: CurrencyCode;
  /** 保存回调，返回 true 表示成功 */
  onSave: (newLimit: number | null) => Promise<boolean>;
  /** 是否禁用 */
  disabled?: boolean;
  /** 触发器节点 */
  children: React.ReactNode;
  /** 是否允许置空（设置为无限额）。整数列（如 sessions）通常不允许 */
  allowClear?: boolean;
}

function formatPreview(
  value: number,
  unit: QuickEditUnit,
  currencyCode: CurrencyCode = "USD"
): string {
  if (unit === "currency") return formatCurrency(value, currencyCode);
  return String(Math.round(value));
}

export function QuotaQuickEditPopover({
  currentLimit,
  label,
  unit = "currency",
  currencyCode = "USD",
  onSave,
  disabled = false,
  children,
  allowClear = true,
}: QuotaQuickEditPopoverProps) {
  const t = useTranslations("quota.quickEdit");
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<QuickEditMode>("set");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = draft.trim();

  const parsedDelta = useMemo(
    () => parseQuickEditDraft(draft, unit),
    [draft, unit]
  );

  // 计算最终限额
  const computedLimit = useMemo<number | null>(
    () => computeQuickEditLimit(mode, draft, currentLimit, unit, allowClear),
    [mode, draft, currentLimit, unit, allowClear]
  );

  const validationError = useMemo<string | null>(() => {
    if (trimmed.length === 0) {
      // set 模式允许空（=清除）；add 模式必须填
      if (mode === "add") return null;
      return null;
    }
    if (parsedDelta == null) return t("invalidNumber");
    if (parsedDelta < 0) return t("negativeNotAllowed");
    if (mode === "add" && (currentLimit ?? 0) + parsedDelta < 0) {
      return t("negativeNotAllowed");
    }
    return null;
  }, [trimmed, parsedDelta, mode, currentLimit, t]);

  const canSave = useMemo(() => {
    if (disabled || saving || validationError != null) return false;
    if (mode === "add") {
      // 增量模式：必须输入大于 0 的值
      return parsedDelta != null && parsedDelta > 0;
    }
    // set 模式：允许空（清除）或有效数值
    if (trimmed.length === 0) return allowClear;
    return parsedDelta != null;
  }, [disabled, saving, validationError, mode, parsedDelta, trimmed, allowClear]);

  // 打开时聚焦
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleOpenChange = (next: boolean) => {
    if (disabled && next) return;
    if (next) {
      setMode("set");
      setDraft("");
      setSaving(false);
    }
    setOpen(next);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const ok = await onSave(computedLimit);
      if (ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const currentDisplay =
    currentLimit == null
      ? t("noLimit")
      : unit === "currency"
        ? formatCurrency(currentLimit, currencyCode)
        : String(currentLimit);

  const previewText = useMemo(() => {
    if (mode === "add") {
      if (parsedDelta == null || parsedDelta <= 0) return null;
      if (computedLimit == null) return null;
      const base = currentLimit ?? 0;
      return `${formatPreview(base, unit, currencyCode)} + ${formatPreview(parsedDelta, unit, currencyCode)} = ${formatPreview(computedLimit, unit, currencyCode)}`;
    }
    if (computedLimit == null) return t("previewNoLimit");
    return t("preview", { value: formatPreview(computedLimit, unit, currencyCode) });
  }, [mode, parsedDelta, computedLimit, currentLimit, unit, currencyCode, t]);

  const suffix = unit === "currency" ? getCurrencySymbol(currencyCode) : null;

  const formContent = (
    <div className="grid gap-3 min-w-[260px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("currentLabel")}: {currentDisplay}
        </span>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as QuickEditMode)}>
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="set" className="text-xs">
            {t("tabs.set")}
          </TabsTrigger>
          <TabsTrigger value="add" className="text-xs">
            {t("tabs.add")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          className="tabular-nums"
          aria-label={label}
          aria-invalid={validationError != null}
          type="number"
          inputMode="decimal"
          step={unit === "integer" ? "1" : "any"}
          min="0"
          placeholder={mode === "add" ? t("addPlaceholder") : t("setPlaceholder")}
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            } else if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
      </div>

      {validationError ? (
        <div className="text-xs text-destructive">{validationError}</div>
      ) : previewText ? (
        <div className="text-xs text-muted-foreground tabular-nums">{previewText}</div>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={!canSave}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );

  if (!isDesktop) {
    return (
      <>
        <span
          onClick={(e) => {
            if (disabled) return;
            e.stopPropagation();
            handleOpenChange(true);
          }}
        >
          {children}
        </span>
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{label}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">{formContent}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-auto p-3"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        {formContent}
      </PopoverContent>
    </Popover>
  );
}
