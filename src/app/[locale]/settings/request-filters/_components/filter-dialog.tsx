"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createRequestFilterAction, updateRequestFilterAction } from "@/actions/request-filters";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  RequestFilter,
  RequestFilterBindingType,
  RequestFilterMatchType,
} from "@/repository/request-filters";
import { GroupMultiSelect } from "./group-multi-select";
import { ProviderMultiSelect } from "./provider-multi-select";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  trigger?: ReactNode;
  filter?: RequestFilter | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Dark themed input component
function DarkInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  className,
}: {
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      className={cn(
        "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground",
        "placeholder:text-muted-foreground/50",
        "focus:border-[#E25706] focus:ring-1 focus:ring-[#E25706] outline-none transition-all",
        className
      )}
    />
  );
}

// Dark themed textarea component
function DarkTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: {
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className={cn(
        "w-full bg-muted/50 border border-border rounded-lg py-2 px-3 text-sm text-foreground resize-none",
        "placeholder:text-muted-foreground/50",
        "focus:border-[#E25706] focus:ring-1 focus:ring-[#E25706] outline-none transition-all",
        className
      )}
    />
  );
}

export function FilterDialog({ mode, trigger, filter, open, onOpenChange }: Props) {
  const t = useTranslations("settings.requestFilters");
  const tCommon = useTranslations("settings");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(open ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(filter?.name ?? "");
  const [scope, setScope] = useState<RequestFilter["scope"]>(filter?.scope ?? "header");
  const [action, setAction] = useState<RequestFilter["action"]>(filter?.action ?? "remove");
  const [target, setTarget] = useState(filter?.target ?? "");
  const [replacement, setReplacement] = useState(() =>
    filter?.replacement !== undefined && filter?.replacement !== null
      ? typeof filter.replacement === "string"
        ? filter.replacement
        : JSON.stringify(filter.replacement)
      : ""
  );
  const [description, setDescription] = useState(filter?.description ?? "");
  const [priority, setPriority] = useState<number>(filter?.priority ?? 0);
  const [matchType, setMatchType] = useState<RequestFilter["matchType"]>(
    filter?.matchType ?? "contains"
  );
  const [isEnabled, setIsEnabled] = useState<boolean>(filter?.isEnabled ?? true);
  const [bindingType, setBindingType] = useState<RequestFilterBindingType>(
    filter?.bindingType ?? "global"
  );
  const [providerIds, setProviderIds] = useState<number[]>(filter?.providerIds ?? []);
  const [groupTags, setGroupTags] = useState<string[]>(filter?.groupTags ?? []);

  useEffect(() => {
    // Sync controlled open prop to internal state
    if (open !== undefined) {
      setDialogOpen(open);
    }
  }, [open]);

  useEffect(() => {
    if (filter) {
      setName(filter.name);
      setScope(filter.scope);
      setAction(filter.action);
      setTarget(filter.target);
      setReplacement(
        filter.replacement !== undefined && filter.replacement !== null
          ? typeof filter.replacement === "string"
            ? filter.replacement
            : JSON.stringify(filter.replacement)
          : ""
      );
      setDescription(filter.description ?? "");
      setPriority(filter.priority);
      setMatchType(filter.matchType ?? "contains");
      setIsEnabled(filter.isEnabled);
      setBindingType(filter.bindingType ?? "global");
      setProviderIds(filter.providerIds ?? []);
      setGroupTags(filter.groupTags ?? []);
    }
  }, [filter]);

  const actionOptions = useMemo(() => {
    return scope === "header"
      ? [
          { value: "remove", label: t("actionLabel.remove") },
          { value: "set", label: t("actionLabel.set") },
        ]
      : [
          { value: "json_path", label: t("actionLabel.json_path") },
          { value: "text_replace", label: t("actionLabel.text_replace") },
        ];
  }, [scope, t]);

  const showMatchType = scope === "body" && action === "text_replace";
  const showReplacement = action === "set" || action === "json_path" || action === "text_replace";

  const handleBindingTypeChange = (value: RequestFilterBindingType) => {
    setBindingType(value);
    // Clear selections when changing binding type
    if (value === "global") {
      setProviderIds([]);
      setGroupTags([]);
    } else if (value === "providers") {
      setGroupTags([]);
    } else if (value === "groups") {
      setProviderIds([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !target.trim()) {
      toast.error(t("dialog.validation.fieldRequired"));
      return;
    }

    setIsSubmitting(true);

    let parsedReplacement: unknown = null;
    if (showReplacement) {
      const raw = replacement.trim();
      if (raw.length > 0) {
        try {
          parsedReplacement = JSON.parse(raw);
        } catch {
          parsedReplacement = raw;
        }
      }
    }

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        scope,
        action,
        target: target.trim(),
        matchType: showMatchType ? (matchType ?? "contains") : null,
        replacement: showReplacement ? parsedReplacement : null,
        priority,
        isEnabled,
        bindingType,
        providerIds: bindingType === "providers" ? providerIds : null,
        groupTags: bindingType === "groups" ? groupTags : null,
      } as const;

      const result =
        mode === "create"
          ? await createRequestFilterAction(payload)
          : await updateRequestFilterAction(filter!.id, payload);

      if (result.ok) {
        toast.success(mode === "create" ? t("addSuccess") : t("editSuccess"));
        setDialogOpen(false);
        onOpenChange?.(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(mode === "create" ? t("addFailed") : t("editFailed"));
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = (
    <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-card/95 backdrop-blur-xl border-border">
      <DialogHeader className="flex-shrink-0">
        <DialogTitle className="text-foreground">
          {mode === "create" ? t("dialog.createTitle") : t("dialog.editTitle")}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground">{t("description")}</DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="grid gap-4 overflow-y-auto pr-2 flex-1">
          <div className="grid gap-2">
            <Label htmlFor="filter-name" className="text-sm font-medium text-foreground">
              {t("dialog.name")}
            </Label>
            <DarkInput
              id="filter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="binding-type" className="text-sm font-medium text-foreground">
                {t("dialog.bindingType")}
              </Label>
              <Select value={bindingType} onValueChange={handleBindingTypeChange}>
                <SelectTrigger
                  id="binding-type"
                  className="bg-muted/50 border-border focus:border-[#E25706] focus:ring-[#E25706]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="global">{t("dialog.bindingGlobal")}</SelectItem>
                  <SelectItem value="providers">{t("dialog.bindingProviders")}</SelectItem>
                  <SelectItem value="groups">{t("dialog.bindingGroups")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {bindingType === "providers" && (
              <div className="grid gap-2">
                <Label className="text-sm font-medium text-foreground">
                  {t("dialog.selectProviders")}
                </Label>
                <ProviderMultiSelect
                  selectedProviderIds={providerIds}
                  onChange={setProviderIds}
                  disabled={isSubmitting}
                />
              </div>
            )}

            {bindingType === "groups" && (
              <div className="grid gap-2">
                <Label className="text-sm font-medium text-foreground">
                  {t("dialog.selectGroups")}
                </Label>
                <GroupMultiSelect
                  selectedGroupTags={groupTags}
                  onChange={setGroupTags}
                  disabled={isSubmitting}
                />
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="filter-scope" className="text-sm font-medium text-foreground">
              {t("dialog.scope")}
            </Label>
            <Select value={scope} onValueChange={(val) => setScope(val as RequestFilter["scope"])}>
              <SelectTrigger
                id="filter-scope"
                className="bg-muted/50 border-border focus:border-[#E25706] focus:ring-[#E25706]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="header">{t("scopeLabel.header")}</SelectItem>
                <SelectItem value="body">{t("scopeLabel.body")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="filter-action" className="text-sm font-medium text-foreground">
              {t("dialog.action")}
            </Label>
            <Select
              value={action}
              onValueChange={(val) => setAction(val as RequestFilter["action"])}
            >
              <SelectTrigger
                id="filter-action"
                className="bg-muted/50 border-border focus:border-[#E25706] focus:ring-[#E25706]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {actionOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showMatchType && (
            <div className="grid gap-2">
              <Label htmlFor="filter-match-type" className="text-sm font-medium text-foreground">
                {t("dialog.matchType")}
              </Label>
              <Select
                value={matchType ?? "contains"}
                onValueChange={(val) => setMatchType(val as RequestFilterMatchType)}
              >
                <SelectTrigger
                  id="filter-match-type"
                  className="bg-muted/50 border-border focus:border-[#E25706] focus:ring-[#E25706]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="contains">{t("dialog.matchTypeContains")}</SelectItem>
                  <SelectItem value="exact">{t("dialog.matchTypeExact")}</SelectItem>
                  <SelectItem value="regex">{t("dialog.matchTypeRegex")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="filter-target" className="text-sm font-medium text-foreground">
              {t("dialog.target")}
            </Label>
            <DarkInput
              id="filter-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={
                action === "json_path"
                  ? t("dialog.jsonPathPlaceholder")
                  : t("dialog.targetPlaceholder")
              }
              required
            />
          </div>

          {showReplacement && (
            <div className="grid gap-2">
              <Label htmlFor="filter-replacement" className="text-sm font-medium text-foreground">
                {t("dialog.replacement")}
              </Label>
              <DarkTextarea
                id="filter-replacement"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("dialog.replacementPlaceholder")}
                rows={3}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="filter-description" className="text-sm font-medium text-foreground">
              {t("dialog.description")}
            </Label>
            <DarkTextarea
              id="filter-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("dialog.description")}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-border/50">
            <div className="grid gap-1">
              <Label htmlFor="filter-priority" className="text-sm font-medium text-foreground">
                {t("dialog.priority")}
              </Label>
              <DarkInput
                id="filter-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-24"
              />
            </div>

            {mode === "edit" && (
              <div className="flex items-center gap-3">
                <Switch
                  id="filter-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                  aria-label={isEnabled ? t("enable") : t("disable")}
                />
                <Label htmlFor="filter-enabled" className="text-sm text-muted-foreground">
                  {isEnabled ? t("enable") : t("disable")}
                </Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 pt-4 border-t border-border/50 mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(false)}
            disabled={isSubmitting}
            className="bg-muted/50 border-border hover:bg-white/10 hover:border-white/20"
          >
            {tCommon("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-[#E25706] hover:bg-[#E25706]/90"
          >
            {isSubmitting ? t("dialog.saving") : t("dialog.save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(v) => {
        setDialogOpen(v);
        onOpenChange?.(v);
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      {content}
    </Dialog>
  );
}
