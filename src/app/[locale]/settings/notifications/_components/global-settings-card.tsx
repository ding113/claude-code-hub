"use client";

import { Bell, Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface GlobalSettingsCardProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void | Promise<void>;
}

export function GlobalSettingsCard({ enabled, onEnabledChange }: GlobalSettingsCardProps) {
  const t = useTranslations("settings");

  return (
    <div
      className={cn(
        "p-4 rounded-xl border flex items-center justify-between gap-4 transition-colors",
        enabled
          ? "bg-primary/5 border-primary/20 hover:border-primary/30"
          : "bg-card/30 border-border/50 hover:border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 flex items-center justify-center rounded-xl shrink-0",
            enabled ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"
          )}
        >
          <Bell className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{t("notifications.global.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("notifications.global.description")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            enabled ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
          )}
        >
          {enabled ? t("notifications.global.on") : t("notifications.global.off")}
        </span>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
    </div>
  );
}
