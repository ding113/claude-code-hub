"use client";

import { Loader2, TestTube } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { NotificationType } from "../_lib/schemas";

interface TestWebhookButtonProps {
  targetId: number;
  disabled?: boolean;
  onTest: (targetId: number, type: NotificationType) => Promise<void> | void;
}

export function TestWebhookButton({ targetId, disabled, onTest }: TestWebhookButtonProps) {
  const t = useTranslations("settings");
  const [type, setType] = useState<NotificationType>("circuit_breaker");
  const [isTesting, setIsTesting] = useState(false);

  const options = useMemo(
    () => [
      { value: "circuit_breaker" as const, label: t("notifications.circuitBreaker.title") },
      { value: "daily_leaderboard" as const, label: t("notifications.dailyLeaderboard.title") },
      { value: "cost_alert" as const, label: t("notifications.costAlert.title") },
    ],
    [t]
  );

  const handleTest = async () => {
    setIsTesting(true);
    try {
      await onTest(targetId, type);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <Select
        value={type}
        onValueChange={(v) => setType(v as NotificationType)}
        disabled={disabled || isTesting}
      >
        <SelectTrigger
          className={cn(
            "w-full sm:w-56 bg-muted/50 border-border",
            "focus:border-primary focus:ring-1 focus:ring-primary"
          )}
        >
          <SelectValue placeholder={t("notifications.targets.testSelectType")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full sm:w-auto"
        disabled={disabled || isTesting}
        onClick={handleTest}
      >
        {isTesting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <TestTube className="mr-2 h-4 w-4" />
        )}
        {t("notifications.targets.test")}
      </Button>
    </div>
  );
}
