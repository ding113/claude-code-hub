"use client";

import { ChevronDown, ChevronRight, ExternalLink, Info, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type SavePublicStatusSettingsInput,
  savePublicStatusSettings,
} from "@/actions/public-status";
import { ModelMultiSelect } from "@/app/[locale]/settings/providers/_components/model-multi-select";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "@/i18n/routing";
import {
  getProviderTypeTranslationKey,
  getUserFacingProviderTypes,
} from "@/lib/provider-type-utils";
import {
  normalizePublicGroupSlug,
  type PublicStatusModelConfig,
  slugifyPublicGroup,
} from "@/lib/public-status/config";
import { PUBLIC_STATUS_INTERVAL_OPTIONS } from "@/lib/public-status/constants";
import { cn } from "@/lib/utils";
import type { ProviderType } from "@/types/provider";
import {
  normalizePublicStatusModels,
  syncSelectedPublicStatusModels,
} from "./public-status-models";

export interface PublicStatusSettingsFormGroup {
  groupName: string;
  enabled: boolean;
  displayName: string;
  publicGroupSlug: string;
  explanatoryCopy: string;
  sortOrder: number;
  publicModels: PublicStatusModelConfig[];
}

interface PublicStatusSettingsFormProps {
  initialWindowHours: number;
  initialAggregationIntervalMinutes: number;
  initialGroups: PublicStatusSettingsFormGroup[];
}

function getPublishableGroupCount(groups: PublicStatusSettingsFormGroup[]): number {
  return groups.filter((group) => group.enabled && group.publicModels.length > 0).length;
}

interface DuplicateSlugErrorState {
  slug: string;
  groupNames: string[];
}

function findDuplicateSlugError(
  groups: PublicStatusSettingsFormGroup[]
): DuplicateSlugErrorState | null {
  const groupNamesBySlug = new Map<string, string[]>();

  for (const group of groups) {
    if (!group.enabled || normalizePublicStatusModels(group.publicModels).length === 0) {
      continue;
    }

    const normalizedSlug = normalizePublicGroupSlug(group.groupName, group.publicGroupSlug);
    const groupNames = groupNamesBySlug.get(normalizedSlug);
    if (groupNames) {
      groupNames.push(group.groupName);
    } else {
      groupNamesBySlug.set(normalizedSlug, [group.groupName]);
    }
  }

  for (const [slug, groupNames] of groupNamesBySlug) {
    if (groupNames.length > 1) {
      return { slug, groupNames };
    }
  }

  return null;
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={text}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PublicStatusSettingsForm({
  initialWindowHours,
  initialAggregationIntervalMinutes,
  initialGroups,
}: PublicStatusSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("settings");
  const tProviderTypes = useTranslations("settings.providerTypes");
  const [windowHours, setWindowHours] = useState(String(initialWindowHours));
  const [aggregationIntervalMinutes, setAggregationIntervalMinutes] = useState(
    String(initialAggregationIntervalMinutes)
  );
  const [groups, setGroups] = useState(() =>
    initialGroups.map((group) => ({
      ...group,
      publicModels: normalizePublicStatusModels(group.publicModels),
    }))
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialGroups.map((group) => [group.groupName, !group.enabled]))
  );
  const [duplicateSlugError, setDuplicateSlugError] = useState<DuplicateSlugErrorState | null>(
    null
  );
  const [isPending, startTransition] = useTransition();
  const slugInputRefs = useRef(new Map<string, HTMLInputElement>());

  const enabledGroupCount = useMemo(() => getPublishableGroupCount(groups), [groups]);
  const previewHref = "/status";
  const providerTypeOptions = useMemo(
    () =>
      getUserFacingProviderTypes().filter(
        (type) => type !== "claude-auth" && type !== "gemini-cli"
      ),
    []
  );

  const updateGroup = (index: number, patch: Partial<PublicStatusSettingsFormGroup>) => {
    setGroups((current) =>
      current.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group))
    );
  };

  const toggleGroupCollapsed = (groupName: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupName]: !current[groupName],
    }));
  };

  const handleSave = () => {
    const nextDuplicateSlugError = findDuplicateSlugError(groups);
    if (nextDuplicateSlugError) {
      setDuplicateSlugError(nextDuplicateSlugError);
      setCollapsedGroups((current) => ({
        ...current,
        ...Object.fromEntries(
          nextDuplicateSlugError.groupNames.map((groupName) => [groupName, false])
        ),
      }));
      toast.error(t("statusPage.form.duplicateSlug", { slug: nextDuplicateSlugError.slug }));

      window.requestAnimationFrame(() => {
        const firstInput = slugInputRefs.current.get(nextDuplicateSlugError.groupNames[0]);
        firstInput?.scrollIntoView({ behavior: "smooth", block: "center" });
        firstInput?.focus();
      });
      return;
    }

    setDuplicateSlugError(null);

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
          publicModels: normalizePublicStatusModels(group.publicModels),
        })),
    };

    startTransition(async () => {
      const result = await savePublicStatusSettings(payload);
      if (!result.ok) {
        toast.error(result.error || t("statusPage.form.saveFailed"));
        return;
      }

      toast.success(t("statusPage.form.saveSuccess"));
      if (
        result.data?.publicStatusProjectionWarningCode === "PUBLIC_STATUS_PROJECTION_PUBLISH_FAILED"
      ) {
        toast.warning(t("statusPage.form.projectionPublishFailed"));
      } else if (result.data?.publicStatusProjectionWarningCode) {
        toast.warning(t("statusPage.form.backgroundRefreshPending"));
      }
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
            <div className="flex items-center gap-1.5">
              <Label htmlFor="public-status-window-hours">{t("statusPage.form.windowHours")}</Label>
              <InfoTip text={t("statusPage.form.windowHoursDesc")} />
            </div>
            <Input
              id="public-status-window-hours"
              type="number"
              min={1}
              max={168}
              value={windowHours}
              onChange={(event) => setWindowHours(event.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="public-status-aggregation-interval">
                {t("statusPage.form.aggregationIntervalMinutes")}
              </Label>
              <InfoTip text={t("statusPage.form.aggregationIntervalMinutesDesc")} />
            </div>
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
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="outline">{enabledGroupCount}</Badge>
          <span>{t("statusPage.form.helper")}</span>
          {enabledGroupCount > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={previewHref}
                target="_blank"
                rel="noreferrer"
                data-testid="public-status-preview-link"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("statusPage.form.preview")}
              </Link>
            </Button>
          ) : null}
        </div>
      </Section>

      <Section
        title={t("statusPage.form.groupsTitle")}
        description={t("statusPage.form.groupsDesc")}
        icon="activity"
      >
        <div className="grid gap-4">
          {groups.map((group, index) => {
            const isCollapsed = collapsedGroups[group.groupName] ?? false;
            const selectedModelKeys = group.publicModels.map((model) => model.modelKey);
            const isSlugConflict =
              duplicateSlugError?.groupNames.includes(group.groupName) ?? false;

            return (
              <Card
                key={group.groupName}
                className={cn(
                  "overflow-hidden",
                  isSlugConflict && "border-destructive/50 bg-destructive/5"
                )}
              >
                <CardHeader className="gap-3 space-y-0 border-b border-border/60 pb-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() => toggleGroupCollapsed(group.groupName)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div className="space-y-1">
                        <CardTitle className="text-base">{group.groupName}</CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={group.enabled ? "default" : "outline"}>
                            {group.enabled
                              ? t("statusPage.form.enabled")
                              : t("statusPage.form.disabled")}
                          </Badge>
                          <Badge variant="secondary">
                            {t("statusPage.form.modelCount", { count: group.publicModels.length })}
                          </Badge>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={group.enabled}
                        onCheckedChange={(checked) =>
                          updateGroup(index, {
                            enabled: checked === true,
                          })
                        }
                        disabled={isPending}
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("statusPage.form.enabled")}
                      </span>
                    </div>
                  </div>
                </CardHeader>

                {!isCollapsed ? (
                  <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("statusPage.form.displayName")}</Label>
                      <Input
                        value={group.displayName}
                        onChange={(event) =>
                          updateGroup(index, {
                            displayName: event.target.value,
                          })
                        }
                        placeholder={t("statusPage.form.displayNamePlaceholder")}
                        disabled={isPending}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label>{t("statusPage.form.slug")}</Label>
                        <InfoTip text={t("statusPage.form.slugTooltip")} />
                      </div>
                      <Input
                        ref={(element) => {
                          if (element) {
                            slugInputRefs.current.set(group.groupName, element);
                          } else {
                            slugInputRefs.current.delete(group.groupName);
                          }
                        }}
                        value={group.publicGroupSlug}
                        onChange={(event) => {
                          setDuplicateSlugError(null);
                          updateGroup(index, {
                            publicGroupSlug: event.target.value,
                          });
                        }}
                        placeholder={slugifyPublicGroup(group.displayName || group.groupName)}
                        disabled={isPending}
                        aria-invalid={isSlugConflict || undefined}
                        className={cn(
                          isSlugConflict &&
                            "border-destructive bg-destructive/5 focus-visible:border-destructive focus-visible:ring-destructive/30"
                        )}
                      />
                      {isSlugConflict ? (
                        <p className="text-sm text-destructive">
                          {t("statusPage.form.duplicateSlug", {
                            slug: duplicateSlugError?.slug ?? "",
                          })}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>{t("statusPage.form.copy")}</Label>
                      <Textarea
                        value={group.explanatoryCopy}
                        onChange={(event) =>
                          updateGroup(index, {
                            explanatoryCopy: event.target.value,
                          })
                        }
                        disabled={isPending}
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label>{t("statusPage.form.sortOrder")}</Label>
                        <InfoTip text={t("statusPage.form.sortOrderTooltip")} />
                      </div>
                      <Input
                        type="number"
                        value={String(group.sortOrder)}
                        onChange={(event) =>
                          updateGroup(index, {
                            sortOrder: Number(event.target.value || "0"),
                          })
                        }
                        disabled={isPending}
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label>{t("statusPage.form.models")}</Label>
                      <ModelMultiSelect
                        providerType="openai-compatible"
                        catalogScope="all"
                        selectedModels={selectedModelKeys}
                        emptyLabel={t("statusPage.form.modelsEmpty")}
                        onChange={(nextModelKeys) =>
                          updateGroup(index, {
                            publicModels: syncSelectedPublicStatusModels(
                              group.publicModels,
                              nextModelKeys
                            ),
                          })
                        }
                        disabled={isPending}
                      />
                      <p className="text-sm text-muted-foreground">
                        {t("statusPage.form.modelsDesc")}
                      </p>
                    </div>

                    {group.publicModels.length > 0 ? (
                      <div className="space-y-3 md:col-span-2">
                        <Label>{t("statusPage.form.providerOverride")}</Label>
                        <div className="grid gap-3">
                          {group.publicModels.map((model) => (
                            <div
                              key={model.modelKey}
                              className="grid gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_220px]"
                            >
                              <div className="space-y-1">
                                <p className="font-mono text-sm">{model.modelKey}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t("statusPage.form.providerOverrideDesc")}
                                </p>
                              </div>

                              <Select
                                value={model.providerTypeOverride ?? "__auto__"}
                                onValueChange={(value) =>
                                  updateGroup(index, {
                                    publicModels: group.publicModels.map((currentModel) =>
                                      currentModel.modelKey === model.modelKey
                                        ? {
                                            ...currentModel,
                                            providerTypeOverride:
                                              value === "__auto__"
                                                ? undefined
                                                : (value as ProviderType),
                                          }
                                        : currentModel
                                    ),
                                  })
                                }
                                disabled={isPending}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__auto__">
                                    {t("statusPage.form.providerOverrideAuto")}
                                  </SelectItem>
                                  {providerTypeOptions.map((providerType) => (
                                    <SelectItem key={providerType} value={providerType}>
                                      {tProviderTypes(getProviderTypeTranslationKey(providerType))}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
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
