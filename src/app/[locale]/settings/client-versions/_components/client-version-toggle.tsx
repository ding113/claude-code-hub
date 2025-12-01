"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSystemSettings } from "@/actions/system-config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ClientVersionToggleProps {
  enabled: boolean;
}

export function ClientVersionToggle({ enabled }: ClientVersionToggleProps) {
  const t = useTranslations("settings.clientVersions");
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, startTransition] = useTransition();

  async function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await saveSystemSettings({
        enableClientVersionCheck: checked,
      });

      if (result.ok) {
        setIsEnabled(checked);
        toast.success(checked ? t("toggle.enableSuccess") : t("toggle.disableSuccess"));
      } else {
        toast.error(result.error || t("toggle.toggleFailed"));
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* 开关 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="enable-version-check">{t("toggle.enable")}</Label>
          <p className="text-sm text-muted-foreground">{t("toggle.description")}</p>
        </div>
        <Switch
          id="enable-version-check"
          checked={isEnabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
        />
      </div>

      {/* 详细说明 */}
      <Alert variant={isEnabled ? "destructive" : "default"}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t("features.title")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <div>
            <strong>{t("features.whatHappens")}</strong>
          </div>
          <ul className="list-inside list-disc space-y-1">
            <li>{t("features.autoDetect")}</li>
            <li>
              <strong>{t("features.gaRule")}</strong>
              {t("features.gaRuleDesc")}
            </li>
            <li>
              <strong>{t("features.activeWindow")}</strong>
              {t("features.activeWindowDesc")}
            </li>
            <li className={isEnabled ? "text-destructive font-semibold" : ""}>
              {t("features.blockOldVersion")}
            </li>
            <li>{t("features.errorMessage")}</li>
          </ul>

          <div className="mt-3 pt-3 border-t">
            <strong>{t("features.recommendation")}</strong>
            <span className="ml-2">{t("features.recommendationDesc")}</span>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
