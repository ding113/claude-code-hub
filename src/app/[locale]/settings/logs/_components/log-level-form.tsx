"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export function LogLevelForm() {
  const t = useTranslations("settings.logs");
  const [currentLevel, setCurrentLevel] = useState<LogLevel>("info");
  const [selectedLevel, setSelectedLevel] = useState<LogLevel>("info");
  const [isPending, startTransition] = useTransition();

  const LOG_LEVELS: { value: LogLevel; label: string; description: string }[] = [
    { value: "fatal", label: t("levels.fatal.label"), description: t("levels.fatal.description") },
    { value: "error", label: t("levels.error.label"), description: t("levels.error.description") },
    { value: "warn", label: t("levels.warn.label"), description: t("levels.warn.description") },
    { value: "info", label: t("levels.info.label"), description: t("levels.info.description") },
    { value: "debug", label: t("levels.debug.label"), description: t("levels.debug.description") },
    { value: "trace", label: t("levels.trace.label"), description: t("levels.trace.description") },
  ];

  useEffect(() => {
    fetch("/api/admin/log-level")
      .then((res) => res.json())
      .then((data) => {
        setCurrentLevel(data.level);
        setSelectedLevel(data.level);
      })
      .catch(() => {
        toast.error(t("form.fetchFailed"));
      });
  }, [t]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/log-level", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: selectedLevel }),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || t("form.failed"));
          return;
        }

        setCurrentLevel(selectedLevel);
        toast.success(t("form.success", { level: selectedLevel.toUpperCase() }));
      } catch {
        toast.error(t("form.failedError"));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="log-level">{t("form.currentLevel")}</Label>
        <Select
          value={selectedLevel}
          onValueChange={(value) => setSelectedLevel(value as LogLevel)}
        >
          <SelectTrigger id="log-level" disabled={isPending}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                <div className="flex flex-col">
                  <span className="font-medium">{level.label}</span>
                  <span className="text-xs text-muted-foreground">{level.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("form.effectiveImmediately")}</p>
      </div>

      <div className="rounded-lg border border-dashed border-border px-4 py-3 space-y-2">
        <h4 className="text-sm font-medium">{t("form.levelGuideTitle")}</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>{t("form.levelGuideFatal")}</li>
          <li>{t("form.levelGuideWarn")}</li>
          <li>{t("form.levelGuideInfo")}</li>
          <li>{t("form.levelGuideDebug")}</li>
          <li>{t("form.levelGuideTrace")}</li>
        </ul>
      </div>

      {selectedLevel !== currentLevel && (
        <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 px-4 py-3">
          <p className="text-sm text-orange-800 dark:text-orange-200">
            {t("form.changeNotice", {
              current: currentLevel.toUpperCase(),
              selected: selectedLevel.toUpperCase(),
            })}
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || selectedLevel === currentLevel}>
          {isPending ? t("form.saving") : t("form.save")}
        </Button>
      </div>
    </form>
  );
}
