"use client";

import { AlertCircle, Shield, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSystemSettings } from "@/actions/system-config";
import { cn } from "@/lib/utils";
import { SettingsToggleRow } from "../../_components/ui/settings-ui";

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
      {/* Toggle Row */}
      <SettingsToggleRow
        title={t("toggle.enable")}
        description={t("toggle.description")}
        icon={isEnabled ? ShieldCheck : Shield}
        iconBgColor={isEnabled ? "bg-[#E25706]/10" : "bg-muted/50"}
        iconColor={isEnabled ? "text-[#E25706]" : "text-muted-foreground"}
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />

      {/* Feature Alert */}
      <div
        className={cn(
          "p-4 rounded-xl border transition-colors",
          isEnabled ? "bg-[#E25706]/5 border-[#E25706]/20" : "bg-white/[0.02] border-white/5"
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn("p-2 rounded-lg shrink-0", isEnabled ? "bg-[#E25706]/10" : "bg-white/5")}
          >
            <AlertCircle
              className={cn("h-4 w-4", isEnabled ? "text-[#E25706]" : "text-muted-foreground")}
            />
          </div>
          <div className="space-y-3 min-w-0">
            <p className="text-sm font-medium text-foreground">{t("features.title")}</p>
            <div className="text-xs text-muted-foreground space-y-2">
              <p className="font-medium">{t("features.whatHappens")}</p>
              <ul className="list-inside list-disc space-y-1 ml-1">
                <li>{t("features.autoDetect")}</li>
                <li>
                  <span className="font-medium">{t("features.gaRule")}</span>
                  {t("features.gaRuleDesc")}
                </li>
                <li>
                  <span className="font-medium">{t("features.activeWindow")}</span>
                  {t("features.activeWindowDesc")}
                </li>
                <li className={isEnabled ? "text-[#E25706] font-medium" : ""}>
                  {t("features.blockOldVersion")}
                </li>
                <li>{t("features.errorMessage")}</li>
              </ul>

              <div className="mt-3 pt-3 border-t border-white/5">
                <span className="font-medium">{t("features.recommendation")}</span>
                <span className="ml-1">{t("features.recommendationDesc")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
