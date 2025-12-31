"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface InlineEditPopoverProps {
  value: number;
  label: string;
  onSave: (value: number) => Promise<boolean>; // 返回是否成功
  validator: (value: string) => string | null; // 返回 null 表示有效，否则返回错误信息
  disabled?: boolean;
  suffix?: string; // 如 "x" 用于 costMultiplier 显示
  type?: "integer" | "number"; // 输入类型
}

export function InlineEditPopover({
  value,
  label,
  onSave,
  validator,
  disabled = false,
  suffix,
  type = "number",
}: InlineEditPopoverProps) {
  const t = useTranslations("settings.providers.inlineEdit");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => value.toString());
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const initialValueRef = useRef<number>(value);

  const trimmedDraft = draft.trim();

  const validationError = useMemo(() => {
    return validator(trimmedDraft);
  }, [trimmedDraft, validator]);

  const parsedValue = useMemo(() => {
    if (trimmedDraft.length === 0) return null;
    const numeric = Number(trimmedDraft);
    if (Number.isNaN(numeric)) return null;
    if (type === "integer" && !Number.isInteger(numeric)) return null;
    return numeric;
  }, [trimmedDraft, type]);

  const canSave = !disabled && !saving && validationError == null && parsedValue != null;

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

  const resetDraft = () => {
    setDraft(initialValueRef.current.toString());
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;

    if (nextOpen) {
      initialValueRef.current = value;
      setDraft(value.toString());
    } else {
      resetDraft();
      setSaving(false);
    }

    setOpen(nextOpen);
  };

  const handleCancel = () => {
    resetDraft();
    setOpen(false);
  };

  const handleSave = async () => {
    if (!canSave || parsedValue == null) return;

    setSaving(true);
    try {
      const ok = await onSave(parsedValue);
      if (ok) {
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "tabular-nums font-medium underline-offset-4 rounded-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            disabled ? "cursor-default text-muted-foreground" : "cursor-pointer hover:underline"
          )}
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
        >
          {value}
          {suffix}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-auto p-3"
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        <div className="grid gap-2">
          <div className="text-xs font-medium">{label}</div>

          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled || saving}
              className="w-24 tabular-nums"
              aria-label={label}
              aria-invalid={validationError != null}
              type="number"
              inputMode="decimal"
              step={type === "integer" ? "1" : "any"}
              onPointerDown={stopPropagation}
              onClick={stopPropagation}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancel();
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
            {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
          </div>

          {validationError && <div className="text-xs text-destructive">{validationError}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={!canSave}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
