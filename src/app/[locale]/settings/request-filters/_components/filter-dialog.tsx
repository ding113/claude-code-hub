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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { RequestFilter, RequestFilterMatchType } from "@/repository/request-filters";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  trigger?: ReactNode;
  filter?: RequestFilter | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
          // 尝试解析 JSON，失败则按字符串处理
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
    <DialogContent>
      <form onSubmit={handleSubmit} className="space-y-4">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("dialog.createTitle") : t("dialog.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="filter-name">{t("dialog.name")}</Label>
            <Input
              id="filter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="filter-scope">{t("dialog.scope")}</Label>
            <Select value={scope} onValueChange={(val) => setScope(val as RequestFilter["scope"])}>
              <SelectTrigger id="filter-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">{t("scopeLabel.header")}</SelectItem>
                <SelectItem value="body">{t("scopeLabel.body")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="filter-action">{t("dialog.action")}</Label>
            <Select
              value={action}
              onValueChange={(val) => setAction(val as RequestFilter["action"])}
            >
              <SelectTrigger id="filter-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              <Label htmlFor="filter-match-type">{t("dialog.matchType")}</Label>
              <Select
                value={matchType ?? "contains"}
                onValueChange={(val) => setMatchType(val as RequestFilterMatchType)}
              >
                <SelectTrigger id="filter-match-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{t("dialog.matchTypeContains")}</SelectItem>
                  <SelectItem value="exact">{t("dialog.matchTypeExact")}</SelectItem>
                  <SelectItem value="regex">{t("dialog.matchTypeRegex")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="filter-target">{t("dialog.target")}</Label>
            <Input
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
              <Label htmlFor="filter-replacement">{t("dialog.replacement")}</Label>
              <Textarea
                id="filter-replacement"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("dialog.replacementPlaceholder")}
                rows={3}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="filter-description">{t("dialog.description")}</Label>
            <Textarea
              id="filter-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("dialog.description")}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1 text-sm text-muted-foreground">
              <Label htmlFor="filter-priority">{t("dialog.priority")}</Label>
              <Input
                id="filter-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>

            {mode === "edit" && (
              <div className="flex items-center gap-2">
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

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(false)}
            disabled={isSubmitting}
          >
            {tCommon("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
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
