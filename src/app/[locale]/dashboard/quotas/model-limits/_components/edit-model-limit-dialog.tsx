"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ModelGroupLimitResponse,
  type ModelGroupLimitUpsertInput,
  upsertModelGroupLimit,
} from "@/lib/api-client/v1/actions/model-limits";
import { CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils/currency";
import { SearchableSelect } from "./searchable-select";

type SubjectType = "user" | "user_group" | "key";
type ResetMode = "fixed" | "rolling";

export interface ModelLimitSelectableData {
  users: { id: number; name: string }[];
  userGroups: { id: number; name: string }[];
  keys: { id: number; label: string }[];
  modelGroups: { id: number; name: string }[];
}

interface EditModelLimitDialogProps {
  subjectType?: SubjectType;
  subjectId?: number | null;
  modelGroupId?: number | null;
  modelGroupName?: string;
  currencyCode?: CurrencyCode;
  existing?: ModelGroupLimitResponse;
  onSaved: () => void | Promise<void>;
  trigger?: React.ReactNode;
  selectable?: ModelLimitSelectableData;
}

function toInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseUsd(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function EditModelLimitDialog({
  subjectType,
  subjectId,
  modelGroupId,
  modelGroupName,
  currencyCode = "USD",
  existing,
  onSaved,
  trigger,
  selectable,
}: EditModelLimitDialogProps) {
  const t = useTranslations("quota.modelLimits.dialog");
  const tt = useTranslations("quota.modelLimits");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(existing);
  const allowSelect = !isEdit && Boolean(selectable);
  const currencySymbol = CURRENCY_CONFIG[currencyCode].symbol;

  const [selSubjectType, setSelSubjectType] = useState<SubjectType>(subjectType ?? "user");
  const [selSubjectId, setSelSubjectId] = useState<number | null>(subjectId ?? null);
  const [selKeyValue, setSelKeyValue] = useState("");
  const [selModelGroupId, setSelModelGroupId] = useState<number | null>(modelGroupId ?? null);
  const [limit5h, setLimit5h] = useState(toInput(existing?.limit5hUsd));
  const [limitDaily, setLimitDaily] = useState(toInput(existing?.dailyLimitUsd));
  const [limitWeekly, setLimitWeekly] = useState(toInput(existing?.limitWeeklyUsd));
  const [limitMonthly, setLimitMonthly] = useState(toInput(existing?.limitMonthlyUsd));
  const [limitTotal, setLimitTotal] = useState(toInput(existing?.limitTotalUsd));
  const [resetMode, setResetMode] = useState<ResetMode>(existing?.limit5hResetMode ?? "fixed");

  const subjectLabel = useMemo(() => {
    if (selSubjectType === "user") return tt("subjectTypeUser");
    if (selSubjectType === "user_group") return tt("subjectTypeUserGroup");
    return tt("subjectTypeKey");
  }, [selSubjectType, tt]);

  const subjectOptions = useMemo(() => {
    if (!selectable) return [];
    if (selSubjectType === "user") {
      return selectable.users.map((u) => ({ value: String(u.id), label: u.name }));
    }
    if (selSubjectType === "user_group") {
      return selectable.userGroups.map((g) => ({ value: String(g.id), label: g.name }));
    }
    return selectable.keys.map((k) => ({ value: String(k.id), label: k.label }));
  }, [selectable, selSubjectType]);

  const modelGroupOptions = useMemo(
    () => selectable?.modelGroups.map((g) => ({ value: String(g.id), label: g.name })) ?? [],
    [selectable]
  );

  const effectiveModelGroupName = useMemo(() => {
    if (!allowSelect) return modelGroupName ?? "";
    return selectable?.modelGroups.find((g) => g.id === selModelGroupId)?.name ?? "";
  }, [allowSelect, modelGroupName, selectable, selModelGroupId]);

  const resetForm = () => {
    setSelSubjectType(subjectType ?? "user");
    setSelSubjectId(subjectId ?? null);
    setSelKeyValue("");
    setSelModelGroupId(modelGroupId ?? null);
    setLimit5h(toInput(existing?.limit5hUsd));
    setLimitDaily(toInput(existing?.dailyLimitUsd));
    setLimitWeekly(toInput(existing?.limitWeeklyUsd));
    setLimitMonthly(toInput(existing?.limitMonthlyUsd));
    setLimitTotal(toInput(existing?.limitTotalUsd));
    setResetMode(existing?.limit5hResetMode ?? "fixed");
  };

  const handleOpenChange = (next: boolean) => {
    if (next) resetForm();
    setOpen(next);
  };

  const handleSubjectTypeChange = (next: string) => {
    setSelSubjectType(next as SubjectType);
    setSelSubjectId(null);
    setSelKeyValue("");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const finalSubjectType = allowSelect ? selSubjectType : subjectType;
    const finalSubjectId = allowSelect ? selSubjectId : subjectId;
    const finalModelGroupId = allowSelect ? selModelGroupId : modelGroupId;

    if (finalSubjectType === undefined) {
      toast.error(t("subjectRequired"));
      return;
    }
    if (finalSubjectType === "key") {
      if (!selKeyValue.trim()) {
        toast.error(t("subjectRequired"));
        return;
      }
    } else if (finalSubjectId === null || finalSubjectId === undefined) {
      toast.error(t("subjectRequired"));
      return;
    }
    if (finalModelGroupId === null || finalModelGroupId === undefined) {
      toast.error(t("modelGroupRequired"));
      return;
    }

    const limitFields = {
      limit5hUsd: parseUsd(limit5h),
      limit5hResetMode: resetMode,
      dailyLimitUsd: parseUsd(limitDaily),
      limitWeeklyUsd: parseUsd(limitWeekly),
      limitMonthlyUsd: parseUsd(limitMonthly),
      limitTotalUsd: parseUsd(limitTotal),
    };

    const body: ModelGroupLimitUpsertInput =
      finalSubjectType === "key"
        ? {
            subjectType: finalSubjectType,
            keyValue: selKeyValue.trim(),
            modelGroupId: finalModelGroupId,
            ...limitFields,
          }
        : {
            subjectType: finalSubjectType,
            subjectId: finalSubjectId!,
            modelGroupId: finalModelGroupId,
            ...limitFields,
          };

    startTransition(async () => {
      const result = await upsertModelGroupLimit(body);
      if (result.ok) {
        toast.success(t("saveSuccess"));
        setOpen(false);
        await onSaved();
        router.refresh();
      } else {
        toast.error(result.error ?? t("saveError"));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>
            {allowSelect && !effectiveModelGroupName
              ? t("selectDescription")
              : t("description", { group: effectiveModelGroupName })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {allowSelect && (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{tt("subjectType")}</Label>
                <Tabs value={selSubjectType} onValueChange={handleSubjectTypeChange}>
                  <TabsList>
                    <TabsTrigger value="user">{tt("subjectTypeUser")}</TabsTrigger>
                    <TabsTrigger value="user_group">{tt("subjectTypeUserGroup")}</TabsTrigger>
                    <TabsTrigger value="key">{tt("subjectTypeKey")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{subjectLabel}</Label>
                  {selSubjectType === "key" ? (
                    <Input
                      value={selKeyValue}
                      onChange={(e) => setSelKeyValue(e.target.value)}
                      placeholder="sk-..."
                      disabled={isPending}
                      className="h-9 font-mono text-xs"
                    />
                  ) : (
                    <SearchableSelect
                      value={selSubjectId !== null ? String(selSubjectId) : ""}
                      onValueChange={(v) => setSelSubjectId(v ? Number(v) : null)}
                      options={subjectOptions}
                      placeholder={t("subjectRequired")}
                      searchPlaceholder={tt("searchSubject")}
                      emptyText={tt("noResults")}
                      disabled={isPending}
                      className="w-full"
                    />
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs">{tt("modelGroup")}</Label>
                  <SearchableSelect
                    value={selModelGroupId !== null ? String(selModelGroupId) : ""}
                    onValueChange={(v) => setSelModelGroupId(v ? Number(v) : null)}
                    options={modelGroupOptions}
                    placeholder={t("modelGroupRequired")}
                    searchPlaceholder={tt("searchModelGroup")}
                    emptyText={tt("noResults")}
                    disabled={isPending}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="limit5h" className="text-xs">
                {t("fiveHour")} ({currencySymbol})
              </Label>
              <Input
                id="limit5h"
                type="number"
                step="0.01"
                min="0"
                value={limit5h}
                onChange={(e) => setLimit5h(e.target.value)}
                placeholder={t("unlimited")}
                className="h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="limitDaily" className="text-xs">
                {t("daily")} ({currencySymbol})
              </Label>
              <Input
                id="limitDaily"
                type="number"
                step="0.01"
                min="0"
                value={limitDaily}
                onChange={(e) => setLimitDaily(e.target.value)}
                placeholder={t("unlimited")}
                className="h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="limitWeekly" className="text-xs">
                {t("weekly")} ({currencySymbol})
              </Label>
              <Input
                id="limitWeekly"
                type="number"
                step="0.01"
                min="0"
                value={limitWeekly}
                onChange={(e) => setLimitWeekly(e.target.value)}
                placeholder={t("unlimited")}
                className="h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="limitMonthly" className="text-xs">
                {t("monthly")} ({currencySymbol})
              </Label>
              <Input
                id="limitMonthly"
                type="number"
                step="0.01"
                min="0"
                value={limitMonthly}
                onChange={(e) => setLimitMonthly(e.target.value)}
                placeholder={t("unlimited")}
                className="h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="limitTotal" className="text-xs">
                {t("total")} ({currencySymbol})
              </Label>
              <Input
                id="limitTotal"
                type="number"
                step="0.01"
                min="0"
                value={limitTotal}
                onChange={(e) => setLimitTotal(e.target.value)}
                placeholder={t("unlimited")}
                className="h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="resetMode" className="text-xs">
                {t("resetMode")}
              </Label>
              <Select
                value={resetMode}
                onValueChange={(v: ResetMode) => setResetMode(v)}
                disabled={isPending}
              >
                <SelectTrigger id="resetMode" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">{t("resetModeFixed")}</SelectItem>
                  <SelectItem value="rolling">{t("resetModeRolling")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
