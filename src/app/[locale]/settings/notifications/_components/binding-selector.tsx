"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, Save, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  ClientActionResult,
  NotificationBindingState,
  WebhookTargetState,
} from "../_lib/hooks";
import type { NotificationType } from "../_lib/schemas";
import { TemplateEditor } from "./template-editor";

interface BindingSelectorProps {
  type: NotificationType;
  targets: WebhookTargetState[];
  bindings: NotificationBindingState[];
  onSave: (
    type: NotificationType,
    bindings: Array<{
      targetId: number;
      isEnabled?: boolean;
      scheduleCron?: string | null;
      scheduleTimezone?: string | null;
      templateOverride?: Record<string, unknown> | null;
    }>
  ) => Promise<ClientActionResult<void>>;
}

const BindingFormSchema = z.object({
  targetId: z.number().int().positive(),
  isBound: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  scheduleCron: z.string().trim().optional().nullable(),
  scheduleTimezone: z.string().trim().optional().nullable(),
  templateOverrideJson: z.string().trim().optional().nullable(),
});

const BindingsFormSchema = z.object({ rows: z.array(BindingFormSchema) });

type BindingFormValues = z.input<typeof BindingFormSchema>;
type BindingsFormValues = z.input<typeof BindingsFormSchema>;

function toJsonString(value: unknown): string {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseJsonObjectOrNull(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模板覆盖必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

export function BindingSelector({ type, targets, bindings, onSave }: BindingSelectorProps) {
  const t = useTranslations("settings");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateEditingTargetId, setTemplateEditingTargetId] = useState<number | null>(null);

  const bindingByTargetId = useMemo(() => {
    const map = new Map<number, NotificationBindingState>();
    bindings.forEach((b) => map.set(b.targetId, b));
    return map;
  }, [bindings]);

  const formValues = useMemo<BindingFormValues[]>(() => {
    return targets.map((target) => {
      const binding = bindingByTargetId.get(target.id);
      return {
        targetId: target.id,
        isBound: Boolean(binding),
        isEnabled: binding?.isEnabled ?? true,
        scheduleCron: binding?.scheduleCron ?? null,
        scheduleTimezone: binding?.scheduleTimezone ?? null,
        templateOverrideJson: toJsonString(binding?.templateOverride),
      };
    });
  }, [bindingByTargetId, targets]);

  const {
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isDirty },
  } = useForm<BindingsFormValues>({
    resolver: zodResolver(BindingsFormSchema),
    defaultValues: { rows: formValues },
  });

  useEffect(() => {
    reset({ rows: formValues });
  }, [formValues, reset]);

  const rows = watch("rows");

  const openTemplateDialog = (targetId: number) => {
    setTemplateEditingTargetId(targetId);
    setTemplateDialogOpen(true);
  };

  const closeTemplateDialog = () => {
    setTemplateDialogOpen(false);
    setTemplateEditingTargetId(null);
  };

  const templateEditingIndex = useMemo(() => {
    if (templateEditingTargetId === null) return -1;
    return rows.findIndex((r) => r.targetId === templateEditingTargetId);
  }, [rows, templateEditingTargetId]);

  const templateValue =
    templateEditingIndex >= 0 ? (rows[templateEditingIndex]?.templateOverrideJson ?? "") : "";

  const save = async (values: BindingsFormValues) => {
    try {
      const payload = values.rows
        .filter((r) => r.isBound)
        .map((r) => ({
          targetId: r.targetId,
          isEnabled: r.isEnabled,
          scheduleCron: r.scheduleCron?.trim() ? r.scheduleCron.trim() : null,
          scheduleTimezone: r.scheduleTimezone?.trim() ? r.scheduleTimezone.trim() : null,
          templateOverride: parseJsonObjectOrNull(r.templateOverrideJson),
        }));

      const result = await onSave(type, payload);
      if (!result.ok) {
        toast.error(result.error || t("notifications.form.saveFailed"));
        return;
      }

      toast.success(t("notifications.targets.bindingsSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("notifications.form.saveFailed"));
    }
  };

  const hasTargets = targets.length > 0;

  return (
    <div className="space-y-3">
      {!hasTargets ? (
        <div className="text-muted-foreground text-sm">{t("notifications.bindings.noTargets")}</div>
      ) : (
        <div className="grid gap-3">
          {targets.map((target, index) => {
            const row = rows[index];
            const isBound = row?.isBound ?? false;
            const canEditTemplate = target.providerType === "custom" && isBound;
            const isRowExpanded = expanded[target.id] ?? false;

            return (
              <Card key={target.id} className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isBound}
                      onCheckedChange={(checked) =>
                        setValue(`rows.${index}.isBound`, Boolean(checked), { shouldDirty: true })
                      }
                      aria-label={t("notifications.bindings.bindTarget")}
                    />

                    <div className="min-w-0">
                      <div className="truncate font-medium">{target.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {t(`notifications.targetDialog.types.${target.providerType}` as any)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:justify-end">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`binding-enabled-${type}-${target.id}`} className="text-sm">
                        {t("notifications.bindings.enable")}
                      </Label>
                      <Switch
                        id={`binding-enabled-${type}-${target.id}`}
                        checked={row?.isEnabled ?? true}
                        disabled={!isBound}
                        onCheckedChange={(checked) =>
                          setValue(`rows.${index}.isEnabled`, checked, { shouldDirty: true })
                        }
                      />
                    </div>

                    <Collapsible
                      open={isRowExpanded}
                      onOpenChange={(open) => setExpanded((p) => ({ ...p, [target.id]: open }))}
                    >
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="outline" size="sm" disabled={!isBound}>
                          <Settings2 className="mr-2 h-4 w-4" />
                          {t("notifications.bindings.advanced")}
                          {isRowExpanded ? (
                            <ChevronDown className="ml-2 h-4 w-4" />
                          ) : (
                            <ChevronRight className="ml-2 h-4 w-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="mt-4 space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`scheduleCron-${type}-${target.id}`}>
                              {t("notifications.bindings.scheduleCron")}
                            </Label>
                            <Input
                              id={`scheduleCron-${type}-${target.id}`}
                              value={row?.scheduleCron ?? ""}
                              onChange={(e) =>
                                setValue(`rows.${index}.scheduleCron`, e.target.value, {
                                  shouldDirty: true,
                                })
                              }
                              placeholder={t("notifications.bindings.scheduleCronPlaceholder")}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`scheduleTimezone-${type}-${target.id}`}>
                              {t("notifications.bindings.scheduleTimezone")}
                            </Label>
                            <Input
                              id={`scheduleTimezone-${type}-${target.id}`}
                              value={row?.scheduleTimezone ?? ""}
                              onChange={(e) =>
                                setValue(`rows.${index}.scheduleTimezone`, e.target.value, {
                                  shouldDirty: true,
                                })
                              }
                              placeholder="Asia/Shanghai"
                            />
                          </div>
                        </div>

                        {target.providerType === "custom" ? (
                          <div className="space-y-2">
                            <Label>{t("notifications.bindings.templateOverride")}</Label>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!canEditTemplate}
                              onClick={() => openTemplateDialog(target.id)}
                            >
                              {t("notifications.bindings.editTemplateOverride")}
                            </Button>
                          </div>
                        ) : null}
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="default"
          disabled={!hasTargets || !isDirty}
          onClick={handleSubmit(save)}
        >
          <Save className="mr-2 h-4 w-4" />
          {t("notifications.form.save")}
        </Button>
      </div>

      <Dialog
        open={templateDialogOpen}
        onOpenChange={(open) => (open ? setTemplateDialogOpen(true) : closeTemplateDialog())}
      >
        <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("notifications.bindings.templateOverrideTitle")}</DialogTitle>
          </DialogHeader>

          <TemplateEditor
            value={templateValue}
            onChange={(v) => {
              if (templateEditingIndex >= 0) {
                setValue(`rows.${templateEditingIndex}.templateOverrideJson`, v, {
                  shouldDirty: true,
                });
              }
            }}
            notificationType={type}
          />

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeTemplateDialog}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={closeTemplateDialog}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
