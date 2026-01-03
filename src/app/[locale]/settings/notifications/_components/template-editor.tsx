"use client";

import { Braces, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getTemplatePlaceholders } from "@/lib/webhook/templates/placeholders";
import type { NotificationType } from "../_lib/schemas";

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  notificationType?: NotificationType;
  className?: string;
}

export function TemplateEditor({
  value,
  onChange,
  notificationType,
  className,
}: TemplateEditorProps) {
  const t = useTranslations("settings");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const placeholders = useMemo(() => {
    return getTemplatePlaceholders(notificationType);
  }, [notificationType]);

  const jsonError = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      JSON.parse(trimmed);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : t("notifications.templateEditor.jsonInvalid");
    }
  }, [value, t]);

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + text);
      return;
    }

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);

    // 恢复光标位置
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Braces className="h-4 w-4" />
          {t("notifications.templateEditor.title")}
        </Label>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("notifications.templateEditor.placeholder")}
          className={cn("min-h-[200px] max-h-[400px] font-mono text-sm")}
        />
        {jsonError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("notifications.templateEditor.jsonInvalid")}</AlertTitle>
            <AlertDescription>{jsonError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          {t("notifications.templateEditor.placeholders")}
        </Label>

        <div className="max-h-[400px] overflow-auto rounded-md border p-3">
          <div className="grid gap-2">
            {placeholders.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm">{p.key}</div>
                  <div className="text-muted-foreground text-xs">
                    {p.label} · {p.description}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => insertAtCursor(p.key)}
                >
                  {t("notifications.templateEditor.insert")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
