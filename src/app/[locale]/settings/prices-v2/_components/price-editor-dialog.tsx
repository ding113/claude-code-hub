"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createModelPriceV2, updateModelPriceV2 } from "@/actions/model-prices-v2";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ModelPriceData } from "@/types/model-price";
import type { ModelPriceV2 } from "@/types/model-price-v2";

interface PriceEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  price: ModelPriceV2 | null;
  modelName: string;
  onModelNameChange: (value: string) => void;
  onSaved?: () => void | Promise<void>;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function parsePriceJson(
  raw: string
): { ok: true; data: ModelPriceData } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "INVALID_JSON_OBJECT" };
    }
    return { ok: true, data: parsed as ModelPriceData };
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
}

export function PriceEditorDialog({
  open,
  onOpenChange,
  price,
  modelName,
  onModelNameChange,
  onSaved,
}: PriceEditorDialogProps) {
  const t = useTranslations("prices-v2");
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(price);

  const initialJson = useMemo(() => safeJsonStringify(price?.priceData ?? {}), [price]);
  const [priceJson, setPriceJson] = useState(initialJson);

  useEffect(() => {
    if (!open) return;
    setPriceJson(initialJson);
  }, [open, initialJson]);

  const handleValidateJson = () => {
    const parsed = parsePriceJson(priceJson);
    if (!parsed.ok) {
      toast.error(t("errors.invalidJson"));
      return;
    }
    toast.success(t("messages.saveSuccess"));
  };

  const handleSave = () => {
    startTransition(async () => {
      const parsed = parsePriceJson(priceJson);
      if (!parsed.ok) {
        toast.error(t("errors.invalidJson"));
        return;
      }

      if (!modelName.trim()) {
        toast.error(t("errors.required"));
        return;
      }

      const res =
        isEdit && price
          ? await updateModelPriceV2(price.id, { priceData: parsed.data })
          : await createModelPriceV2({ modelName: modelName.trim(), priceData: parsed.data });

      if (!res.ok) {
        toast.error(t("errors.saveFailed", { error: res.error }));
        return;
      }

      onOpenChange(false);
      await onSaved?.();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editor.title")}</DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("editor.modelName")}</Label>
            <Input
              value={modelName}
              onChange={(e) => onModelNameChange(e.target.value)}
              disabled={pending || isEdit}
              placeholder={t("editor.modelName")}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("editor.priceJson")}</Label>
            <Textarea
              value={priceJson}
              onChange={(e) => setPriceJson(e.target.value)}
              placeholder={t("editor.priceJsonPlaceholder")}
              className="font-mono text-xs min-h-[220px]"
              disabled={pending}
            />
          </div>

          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={handleValidateJson} disabled={pending}>
              {t("editor.validateJson")}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="button" onClick={handleSave} disabled={pending}>
                {pending ? t("actions.saving") : t("actions.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
