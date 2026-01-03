"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface GlobalSettingsCardProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void | Promise<void>;
}

export function GlobalSettingsCard({ enabled, onEnabledChange }: GlobalSettingsCardProps) {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          {t("notifications.global.title")}
        </CardTitle>
        <CardDescription>{t("notifications.global.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="notifications-enabled">{t("notifications.global.enable")}</Label>
          <Switch
            id="notifications-enabled"
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
