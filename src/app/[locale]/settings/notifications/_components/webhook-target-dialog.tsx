"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type {
  ClientActionResult,
  WebhookTargetCreateInput,
  WebhookTargetState,
  WebhookTargetUpdateInput,
} from "../_lib/hooks";
import {
  type NotificationType,
  type WebhookProviderType,
  WebhookProviderTypeSchema,
  WebhookTargetFormSchema,
  type WebhookTargetFormValues,
} from "../_lib/schemas";
import { ProxyConfigSection } from "./proxy-config-section";
import { TestWebhookButton } from "./test-webhook-button";
import { WebhookTypeForm } from "./webhook-type-form";

interface WebhookTargetDialogProps {
  mode: "create" | "edit";
  target?: WebhookTargetState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: WebhookTargetCreateInput) => Promise<ClientActionResult<WebhookTargetState>>;
  onUpdate: (
    id: number,
    input: WebhookTargetUpdateInput
  ) => Promise<ClientActionResult<WebhookTargetState>>;
  onTest: (
    id: number,
    type: NotificationType
  ) => Promise<ClientActionResult<{ latencyMs: number }>>;
}

function toJsonString(value: unknown): string {
  if (!value) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

type TranslateFn = (key: string) => string;

function parseTemplateJson(
  value: string | null | undefined,
  t: TranslateFn
): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(t("notifications.templateEditor.jsonInvalid"));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("notifications.templateEditor.jsonInvalid"));
  }

  return parsed as Record<string, unknown>;
}

function parseHeadersJson(
  value: string | null | undefined,
  t: TranslateFn
): Record<string, string> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(t("notifications.targetDialog.errors.headersInvalidJson"));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("notifications.targetDialog.errors.headersMustBeObject"));
  }

  const record = parsed as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v !== "string") {
      throw new Error(t("notifications.targetDialog.errors.headersValueMustBeString"));
    }
    out[k] = v;
  }

  return out;
}

export function WebhookTargetDialog({
  mode,
  target,
  open,
  onOpenChange,
  onCreate,
  onUpdate,
  onTest,
}: WebhookTargetDialogProps) {
  const t = useTranslations("settings");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultValues = useMemo<WebhookTargetFormValues>(
    () => ({
      name: target?.name ?? "",
      providerType: (target?.providerType ?? "wechat") as WebhookProviderType,
      webhookUrl: target?.webhookUrl ?? "",
      telegramBotToken: target?.telegramBotToken ?? "",
      telegramChatId: target?.telegramChatId ?? "",
      dingtalkSecret: target?.dingtalkSecret ?? "",
      customTemplate: toJsonString(target?.customTemplate),
      customHeaders: toJsonString(target?.customHeaders),
      proxyUrl: target?.proxyUrl ?? "",
      proxyFallbackToDirect: target?.proxyFallbackToDirect ?? false,
      isEnabled: target?.isEnabled ?? true,
    }),
    [target]
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<WebhookTargetFormValues>({
    resolver: zodResolver(WebhookTargetFormSchema),
    defaultValues,
  });

  useEffect(() => {
    if (open) {
      reset(defaultValues);
    }
  }, [defaultValues, open, reset]);

  const providerType = watch("providerType");

  const providerTypeOptions = useMemo(
    () => [
      { value: "wechat" as const, label: t("notifications.targetDialog.types.wechat") },
      { value: "feishu" as const, label: t("notifications.targetDialog.types.feishu") },
      { value: "dingtalk" as const, label: t("notifications.targetDialog.types.dingtalk") },
      { value: "telegram" as const, label: t("notifications.targetDialog.types.telegram") },
      { value: "custom" as const, label: t("notifications.targetDialog.types.custom") },
    ],
    [t]
  );

  const submit = async (values: WebhookTargetFormValues) => {
    setIsSubmitting(true);
    try {
      const normalizedType = WebhookProviderTypeSchema.parse(values.providerType);

      const payload: WebhookTargetCreateInput = {
        name: values.name,
        providerType: normalizedType,
        webhookUrl: values.webhookUrl || null,
        telegramBotToken: values.telegramBotToken || null,
        telegramChatId: values.telegramChatId || null,
        dingtalkSecret: values.dingtalkSecret || null,
        customTemplate:
          normalizedType === "custom" ? parseTemplateJson(values.customTemplate, t) : null,
        customHeaders: parseHeadersJson(values.customHeaders, t),
        proxyUrl: values.proxyUrl || null,
        proxyFallbackToDirect: values.proxyFallbackToDirect,
        isEnabled: values.isEnabled,
      };

      const result =
        mode === "create" ? await onCreate(payload) : await onUpdate(target!.id, payload);

      if (!result.ok) {
        toast.error(result.error || t("notifications.form.saveFailed"));
        return;
      }

      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("notifications.form.saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTest = async (id: number, type: NotificationType) => {
    const result = await onTest(id, type);
    if (result.ok) {
      toast.success(t("notifications.form.testSuccess"));
    } else {
      toast.error(result.error || t("notifications.form.testFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? t("notifications.targetDialog.createTitle")
              : t("notifications.targetDialog.editTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{t("notifications.targetDialog.name")}</Label>
              <Input
                id="name"
                placeholder={t("notifications.targetDialog.namePlaceholder")}
                {...register("name")}
              />
              {errors.name ? (
                <p className="text-sm text-destructive">{errors.name.message as string}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="providerType">{t("notifications.targetDialog.type")}</Label>
              <Select
                value={providerType}
                onValueChange={(v) =>
                  setValue("providerType", v as WebhookProviderType, { shouldValidate: true })
                }
              >
                <SelectTrigger id="providerType">
                  <SelectValue placeholder={t("notifications.targetDialog.selectType")} />
                </SelectTrigger>
                <SelectContent>
                  {providerTypeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.providerType ? (
                <p className="text-sm text-destructive">{errors.providerType.message as string}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="isEnabled">{t("notifications.targetDialog.enable")}</Label>
            <Switch
              id="isEnabled"
              checked={watch("isEnabled")}
              onCheckedChange={(checked) => setValue("isEnabled", checked, { shouldDirty: true })}
            />
          </div>

          <WebhookTypeForm
            providerType={providerType}
            register={register}
            setValue={setValue}
            watch={watch}
            errors={errors}
          />

          <Separator />

          <ProxyConfigSection
            proxyUrl={watch("proxyUrl") || ""}
            proxyFallbackToDirect={watch("proxyFallbackToDirect") ?? false}
            onProxyUrlChange={(v) => setValue("proxyUrl", v, { shouldDirty: true })}
            onProxyFallbackToDirectChange={(v) =>
              setValue("proxyFallbackToDirect", v, { shouldDirty: true })
            }
          />

          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            {mode === "edit" && target ? (
              <TestWebhookButton
                targetId={target.id}
                onTest={(targetId, type) => handleTest(targetId, type)}
              />
            ) : (
              <div />
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : mode === "create" ? (
                <Plus className="mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {mode === "create"
                ? t("notifications.targets.add")
                : t("notifications.targets.update")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
