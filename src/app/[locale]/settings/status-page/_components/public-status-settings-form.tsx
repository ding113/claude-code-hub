"use client";

import { Activity, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type SavePublicStatusSettingsInput,
  savePublicStatusSettings,
} from "@/actions/public-status";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface PublicStatusSettingsFormGroup {
  groupName: string;
  enabled: boolean;
  displayName: string;
  modelIdsText: string;
}

interface PublicStatusSettingsFormProps {
  initialWindowHours: number;
  initialAggregationIntervalMinutes: number;
  initialGroups: PublicStatusSettingsFormGroup[];
}

function parseModelIds(modelIdsText: string): string[] {
  return Array.from(
    new Set(
      modelIdsText
        .split(/\r?\n|,/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function PublicStatusSettingsForm({
  initialWindowHours,
  initialAggregationIntervalMinutes,
  initialGroups,
}: PublicStatusSettingsFormProps) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [windowHours, setWindowHours] = useState(String(initialWindowHours));
  const [aggregationIntervalMinutes, setAggregationIntervalMinutes] = useState(
    String(initialAggregationIntervalMinutes)
  );
  const [groups, setGroups] = useState(initialGroups);

  const enabledGroupCount = useMemo(
    () =>
      groups.filter((group) => group.enabled && parseModelIds(group.modelIdsText).length > 0)
        .length,
    [groups]
  );

  const updateGroup = (groupName: string, patch: Partial<PublicStatusSettingsFormGroup>) => {
    setGroups((current) =>
      current.map((group) => (group.groupName === groupName ? { ...group, ...patch } : group))
    );
  };

  const handleSave = () => {
    const payload: SavePublicStatusSettingsInput = {
      publicStatusWindowHours: Number(windowHours),
      publicStatusAggregationIntervalMinutes: Number(aggregationIntervalMinutes),
      groups: groups
        .filter((group) => group.enabled)
        .map((group) => ({
          groupName: group.groupName,
          displayName: group.displayName.trim() || group.groupName,
          modelIds: parseModelIds(group.modelIdsText),
        }))
        .filter((group) => group.modelIds.length > 0),
    };

    startTransition(async () => {
      const result = await savePublicStatusSettings(payload);
      if (!result.ok) {
        toast.error(result.error || t("statusPage.form.saveFailed"));
        return;
      }

      toast.success(t("statusPage.form.saveSuccess"));
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Section
        title={t("statusPage.title")}
        description={t("statusPage.description")}
        icon="settings"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="public-status-window-hours">{t("statusPage.form.windowHours")}</Label>
            <Input
              id="public-status-window-hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              value={windowHours}
              onChange={(event) => setWindowHours(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t("statusPage.form.windowHoursDesc")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="public-status-aggregation-interval">
              {t("statusPage.form.aggregationIntervalMinutes")}
            </Label>
            <Input
              id="public-status-aggregation-interval"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={aggregationIntervalMinutes}
              onChange={(event) => setAggregationIntervalMinutes(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {t("statusPage.form.aggregationIntervalMinutesDesc")}
            </p>
          </div>
        </div>
      </Section>

      <Section
        title={t("statusPage.form.groupsTitle")}
        description={t("statusPage.form.groupsDesc")}
        icon="settings"
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <Activity className="h-4 w-4" />
          <span>{t("statusPage.form.helper")}</span>
          <Badge variant="outline" className="ml-auto">
            {enabledGroupCount}
          </Badge>
        </div>

        {groups.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("statusPage.form.empty")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <Card key={group.groupName} className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-4 text-base">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={group.enabled}
                        onCheckedChange={(checked) =>
                          updateGroup(group.groupName, { enabled: checked === true })
                        }
                      />
                      <span>{group.groupName}</span>
                    </div>
                    <Badge variant={group.enabled ? "default" : "outline"}>
                      {group.enabled
                        ? t("statusPage.form.enabled")
                        : t("statusPage.form.groupName")}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("statusPage.form.displayName")}</Label>
                    <Input
                      value={group.displayName}
                      placeholder={t("statusPage.form.displayNamePlaceholder")}
                      onChange={(event) =>
                        updateGroup(group.groupName, { displayName: event.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t("statusPage.form.modelIds")}</Label>
                    <Textarea
                      rows={4}
                      value={group.modelIdsText}
                      placeholder={t("statusPage.form.modelIdsPlaceholder")}
                      onChange={(event) =>
                        updateGroup(group.groupName, { modelIdsText: event.target.value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      {t("statusPage.form.modelIdsDesc")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="mr-2 h-4 w-4" />
            {t("statusPage.form.save")}
          </Button>
        </div>
      </Section>
    </div>
  );
}
