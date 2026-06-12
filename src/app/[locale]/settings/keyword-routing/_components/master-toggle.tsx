"use client";

import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSystemSettings } from "@/lib/api-client/v1/actions/system-config";
import { SettingsToggleRow } from "../../_components/ui/settings-ui";

interface MasterToggleProps {
  enabled: boolean;
}

export function MasterToggle({ enabled }: MasterToggleProps) {
  const t = useTranslations("settings.keywordRouting.masterToggle");
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await saveSystemSettings({
        enableKeywordModelRouting: checked,
      });

      if (result.ok) {
        setIsEnabled(checked);
        toast.success(checked ? t("enabled") : t("disabled"));
      } else {
        toast.error(result.error || t("saveFailed"));
      }
    });
  }

  return (
    <SettingsToggleRow
      title={t("label")}
      description={t("description")}
      icon={ArrowRightLeft}
      iconBgColor={isEnabled ? "bg-[#E25706]/10" : "bg-muted/50"}
      iconColor={isEnabled ? "text-[#E25706]" : "text-muted-foreground"}
      checked={isEnabled}
      onCheckedChange={handleToggle}
      disabled={isPending}
    />
  );
}
