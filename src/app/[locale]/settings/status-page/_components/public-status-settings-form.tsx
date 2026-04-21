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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PUBLIC_STATUS_INTERVAL_OPTIONS } from "@/lib/public-status/constants";

export interface PublicStatusSettingsFormGroup {
  groupName: string;
  enabled: boolean;
  displayName: string;
  publicGroupSlug: string;
  explanatoryCopy: string;
  sortOrder: number;
  modelIdsText: string;
}

interface PublicStatusSettingsFormProps {
  initialWindowHours: number;
  initialAggregationIntervalMinutes: number;
  initialGroups: PublicStatusSettingsFormGroup[];
}

function normalizeModelKeys(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function PublicStatusSettingsForm({
  initialWindowHours,
  initialAggregationIntervalMinutes,
  initialGroups,
}: PublicStatusSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("settings");
  const [windowHours, setWindowHours] = useState(String(initialWindowHours));
  const [aggregationIntervalMinutes, setAggregationIntervalMinutes] = useState(
    String(initialAggregationIntervalMinutes)
  );
  const [groups, setGroups] = useState(initialGroups);
  const [isPending, startTransition] = useTransition();

  const enabledGroupCount = useMemo(
    () =>
      groups.filter((group) => group.enabled && normalizeModelKeys(group.modelIdsText).length > 0)
        .length,
    [groups]
  );

  const updateGroup = (index: number, patch: Partial<PublicStatusSettingsFormGroup>) => {
    setGroups((current) =>
      current.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group))
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
          displayName: group.displayName.trim() || undefined,
          publicGroupSlug: group.publicGroupSlug.trim() || undefined,
          explanatoryCopy: group.explanatoryCopy.trim() || null,
          sortOrder: group.sortOrder,
          publicModelKeys: normalizeModelKeys(group.modelIdsText),
        })),
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
              min={1}
              max={168}
              value={windowHours}
              onChange={(event) => setWindowHours(event.target.value)}
              disabled={isPending}
            />
            <p className="text-sm text-muted-foreground">{t("statusPage.form.windowHoursDesc")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="public-status-aggregation-interval">
              {t("statusPage.form.aggregationIntervalMinutes")}
            </Label>
            <Select
              value={aggregationIntervalMinutes}
              onValueChange={setAggregationIntervalMinutes}
              disabled={isPending}
            >
              <SelectTrigger id="public-status-aggregation-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PUBLIC_STATUS_INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {t("statusPage.form.intervalOption", { minutes: option })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("statusPage.form.aggregationIntervalMinutesDesc")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{enabledGroupCount}</Badge>
          <span>{t("statusPage.form.helper")}</span>
        </div>
      </Section>

      <Section
        title={t("statusPage.form.groupsTitle")}
        description={t("statusPage.form.groupsDesc")}
        icon="activity"
      >
        <div className="grid gap-4">
          {groups.map((group, index) => (
            <Card key={group.groupName}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    <span>{group.groupName}</span>
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={group.enabled}
                    onCheckedChange={(checked) => updateGroup(index, { enabled: checked === true })}
                    disabled={isPending}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("statusPage.form.enabled")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("statusPage.form.displayName")}</Label>
                  <Input
                    value={group.displayName}
                    onChange={(event) => updateGroup(index, { displayName: event.target.value })}
                    placeholder={t("statusPage.form.displayNamePlaceholder")}
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("statusPage.form.slug")}</Label>
                  <Input
                    value={group.publicGroupSlug}
                    onChange={(event) =>
                      updateGroup(index, { publicGroupSlug: event.target.value })
                    }
                    placeholder={group.groupName.toLowerCase()}
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("statusPage.form.copy")}</Label>
                  <Textarea
                    value={group.explanatoryCopy}
                    onChange={(event) =>
                      updateGroup(index, { explanatoryCopy: event.target.value })
                    }
                    disabled={isPending}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("statusPage.form.sortOrder")}</Label>
                  <Input
                    type="number"
                    value={String(group.sortOrder)}
                    onChange={(event) =>
                      updateGroup(index, { sortOrder: Number(event.target.value || "0") })
                    }
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>{t("statusPage.form.modelIds")}</Label>
                  <Textarea
                    value={group.modelIdsText}
                    onChange={(event) => updateGroup(index, { modelIdsText: event.target.value })}
                    placeholder={t("statusPage.form.modelIdsPlaceholder")}
                    disabled={isPending}
                    rows={5}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("statusPage.form.modelIdsDesc")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 h-4 w-4" />
          {t("statusPage.form.save")}
        </Button>
      </div>
    </div>
  );
}
