"use client";

import { useTranslations } from "next-intl";
import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WebhookProviderType, WebhookTargetFormValues } from "../_lib/schemas";
import { TemplateEditor } from "./template-editor";

interface WebhookTypeFormProps {
  providerType: WebhookProviderType;
  register: UseFormRegister<WebhookTargetFormValues>;
  setValue: UseFormSetValue<WebhookTargetFormValues>;
  watch: UseFormWatch<WebhookTargetFormValues>;
  errors: FieldErrors<WebhookTargetFormValues>;
}

export function WebhookTypeForm({
  providerType,
  register,
  setValue,
  watch,
  errors,
}: WebhookTypeFormProps) {
  const t = useTranslations("settings");

  if (providerType === "telegram") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="telegramBotToken">
            {t("notifications.targetDialog.telegramBotToken")}
          </Label>
          <Input
            id="telegramBotToken"
            type="password"
            placeholder={t("notifications.targetDialog.telegramBotTokenPlaceholder")}
            {...register("telegramBotToken")}
          />
          {errors.telegramBotToken ? (
            <p className="text-sm text-destructive">{errors.telegramBotToken.message as string}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="telegramChatId">{t("notifications.targetDialog.telegramChatId")}</Label>
          <Input
            id="telegramChatId"
            placeholder={t("notifications.targetDialog.telegramChatIdPlaceholder")}
            {...register("telegramChatId")}
          />
          {errors.telegramChatId ? (
            <p className="text-sm text-destructive">{errors.telegramChatId.message as string}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhookUrl">{t("notifications.targetDialog.webhookUrl")}</Label>
        <Input
          id="webhookUrl"
          placeholder={t("notifications.targetDialog.webhookUrlPlaceholder")}
          {...register("webhookUrl")}
        />
        {errors.webhookUrl ? (
          <p className="text-sm text-destructive">{errors.webhookUrl.message as string}</p>
        ) : null}
      </div>

      {providerType === "dingtalk" ? (
        <div className="space-y-2">
          <Label htmlFor="dingtalkSecret">{t("notifications.targetDialog.dingtalkSecret")}</Label>
          <Input
            id="dingtalkSecret"
            type="password"
            placeholder={t("notifications.targetDialog.dingtalkSecretPlaceholder")}
            {...register("dingtalkSecret")}
          />
          {errors.dingtalkSecret ? (
            <p className="text-sm text-destructive">{errors.dingtalkSecret.message as string}</p>
          ) : null}
        </div>
      ) : null}

      {providerType === "custom" ? (
        <div className="space-y-4">
          <TemplateEditor
            value={watch("customTemplate") || ""}
            onChange={(v) =>
              setValue("customTemplate", v, { shouldValidate: true, shouldDirty: true })
            }
          />

          <div className="space-y-2">
            <Label htmlFor="customHeaders">{t("notifications.targetDialog.customHeaders")}</Label>
            <Textarea
              id="customHeaders"
              placeholder={t("notifications.targetDialog.customHeadersPlaceholder")}
              value={watch("customHeaders") || ""}
              onChange={(e) =>
                setValue("customHeaders", e.target.value, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              className="min-h-[120px] font-mono text-sm"
            />
            {errors.customHeaders ? (
              <p className="text-sm text-destructive">{errors.customHeaders.message as string}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
