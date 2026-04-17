"use client";

import { Download, KeyRound, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTemporaryKeysBatch, type CreateTemporaryKeysBatchResult } from "@/actions/keys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeProviderGroup } from "@/lib/utils/provider-group";
import type { UserDisplay } from "@/types/user";

const QUICK_COUNTS = [5, 10, 20, 50, 100] as const;

function sanitizeFilenameFragment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "temporary-keys";
  return trimmed.replace(/[\\/:*?"<>|,，]+/g, "-").replace(/\s+/g, "-");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function buildKeyTextContent(result: CreateTemporaryKeysBatchResult): string {
  return result.keys.map((item) => item.key).join("\n");
}

export interface TemporaryKeyBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDisplay | null;
  onSuccess?: () => void;
}

export function TemporaryKeyBatchDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: TemporaryKeyBatchDialogProps) {
  const t = useTranslations("dashboard.userManagement.temporaryKeys");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [baseKeyId, setBaseKeyId] = useState("");
  const [count, setCount] = useState("5");
  const [customLimitTotalUsd, setCustomLimitTotalUsd] = useState("");
  const [result, setResult] = useState<CreateTemporaryKeysBatchResult | null>(null);

  const availableKeys = useMemo(
    () => user?.keys.filter((key) => !key.temporaryGroupName?.trim()) ?? [],
    [user]
  );

  useEffect(() => {
    if (!open) return;
    setBaseKeyId(availableKeys[0] ? String(availableKeys[0].id) : "");
    setCount("5");
    setCustomLimitTotalUsd("");
    setResult(null);
  }, [open, availableKeys]);

  const userTemporaryGroup = useMemo(
    () => normalizeProviderGroup(user?.providerGroup || "default"),
    [user?.providerGroup]
  );

  const previewText = useMemo(() => {
    if (!result) return "";
    return result.keys
      .slice(0, 5)
      .map((item) => `${item.name}\n${item.key}`)
      .join("\n\n");
  }, [result]);

  const handleClose = (nextOpen: boolean) => {
    if (isPending) return;
    if (!nextOpen) {
      setResult(null);
    }
    onOpenChange(nextOpen);
  };

  const handleDownload = () => {
    if (!result) return;
    const filename = `${sanitizeFilenameFragment(result.groupName)}-temporary-keys.txt`;
    downloadTextFile(filename, buildKeyTextContent(result));
  };

  const handleSubmit = () => {
    if (!user) return;

    startTransition(async () => {
      const parsedBaseKeyId = Number(baseKeyId);
      const parsedCount = Number(count);
      const parsedCustomLimit =
        customLimitTotalUsd.trim() === "" ? undefined : Number(customLimitTotalUsd);

      if (!Number.isInteger(parsedBaseKeyId) || parsedBaseKeyId <= 0) {
        toast.error(t("createDialog.baseKeyRequired"));
        return;
      }

      if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
        toast.error(t("createDialog.invalidCount"));
        return;
      }

      if (
        parsedCustomLimit !== undefined &&
        (!Number.isFinite(parsedCustomLimit) || parsedCustomLimit < 0)
      ) {
        toast.error(t("createDialog.invalidLimit"));
        return;
      }

      const response = await createTemporaryKeysBatch({
        userId: user.id,
        baseKeyId: parsedBaseKeyId,
        count: parsedCount,
        customLimitTotalUsd: parsedCustomLimit,
      });

      if (!response.ok) {
        toast.error(
          t("toasts.createFailed", {
            error: response.error || t("createDialog.genericError"),
          })
        );
        return;
      }

      setResult(response.data);
      onSuccess?.();
      toast.success(t("toasts.createSuccess", { count: response.data.createdCount }));
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("success.title")}</DialogTitle>
              <DialogDescription>
                {t("success.description", {
                  group: result.groupName,
                  count: result.createdCount,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("success.groupName")}</Label>
                  <Input value={result.groupName} readOnly className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>{t("success.sourceKey")}</Label>
                  <Input value={result.sourceKeyName} readOnly className="bg-muted" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("success.previewTitle")}</Label>
                <Textarea value={previewText} readOnly className="min-h-40 font-mono text-xs" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {tCommon("close")}
              </Button>
              <Button type="button" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t("success.download")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                <DialogTitle>{t("createDialog.title")}</DialogTitle>
              </div>
              <DialogDescription>{t("createDialog.description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label>{t("createDialog.baseKeyLabel")}</Label>
                <Select
                  value={baseKeyId}
                  onValueChange={setBaseKeyId}
                  disabled={availableKeys.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("createDialog.baseKeyPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableKeys.map((key) => (
                      <SelectItem key={key.id} value={String(key.id)}>
                        {key.name}
                        {key.temporaryGroupName ? ` · ${key.temporaryGroupName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableKeys.length === 0 ? (
                  <p className="text-xs text-destructive">{t("createDialog.noKeys")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                  <Label htmlFor="temporary-group-name">{t("createDialog.groupNameLabel")}</Label>
                  <Input
                    id="temporary-group-name"
                    value={userTemporaryGroup}
                    readOnly
                    className="bg-muted"
                  />
                </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="temporary-key-count">{t("createDialog.quantityLabel")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_COUNTS.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        variant={count === String(value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCount(String(value))}
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                </div>
                <Input
                  id="temporary-key-count"
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("createDialog.quantityDescription")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="temporary-total-limit">{t("createDialog.customLimitLabel")}</Label>
                <Input
                  id="temporary-total-limit"
                  type="number"
                  min={0}
                  step="0.01"
                  value={customLimitTotalUsd}
                  onChange={(event) => setCustomLimitTotalUsd(event.target.value)}
                  placeholder={t("createDialog.customLimitPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("createDialog.customLimitDescription")}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || availableKeys.length === 0}
              >
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isPending ? t("createDialog.submitting") : t("createDialog.submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
