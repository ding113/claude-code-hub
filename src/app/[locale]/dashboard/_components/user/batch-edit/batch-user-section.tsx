"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";

export interface BatchUserSectionState {
  noteEnabled: boolean;
  note: string;
  tagsEnabled: boolean;
  tags: string[];
  limit5hUsdEnabled: boolean;
  limit5hUsd: string;
  limitWeeklyUsdEnabled: boolean;
  limitWeeklyUsd: string;
  limitMonthlyUsdEnabled: boolean;
  limitMonthlyUsd: string;
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : `{${key}}`
  );
}

export interface BatchUserSectionProps {
  affectedUsersCount: number;
  state: BatchUserSectionState;
  onChange: (patch: Partial<BatchUserSectionState>) => void;
  translations: {
    title: string;
    affected: string;
    enableFieldAria: string;
    fields: {
      note: string;
      tags: string;
      limit5h: string;
      limitWeekly: string;
      limitMonthly: string;
    };
    placeholders: {
      emptyToClear: string;
      tagsPlaceholder: string;
      emptyNoLimit: string;
    };
  };
}

function FieldCard({
  title,
  enabled,
  onEnabledChange,
  enableFieldAria,
  children,
}: {
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  enableFieldAria: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-md border p-3 space-y-3", !enabled && "opacity-80")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={formatMessage(enableFieldAria, { title })}
        />
      </div>
      {children}
    </div>
  );
}

export function BatchUserSection({
  affectedUsersCount,
  state,
  onChange,
  translations,
}: BatchUserSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">{translations.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatMessage(translations.affected, { count: affectedUsersCount })}
        </div>
      </div>

      <div className="space-y-3">
        <FieldCard
          title={translations.fields.note}
          enabled={state.noteEnabled}
          onEnabledChange={(enabled) => onChange({ noteEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            value={state.note}
            onChange={(e) => onChange({ note: e.target.value })}
            disabled={!state.noteEnabled}
            placeholder={translations.placeholders.emptyToClear}
          />
        </FieldCard>

        <FieldCard
          title={translations.fields.tags}
          enabled={state.tagsEnabled}
          onEnabledChange={(enabled) => onChange({ tagsEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <TagInput
            value={state.tags}
            onChange={(tags) => onChange({ tags })}
            disabled={!state.tagsEnabled}
            placeholder={translations.placeholders.tagsPlaceholder}
          />
        </FieldCard>

        <FieldCard
          title={translations.fields.limit5h}
          enabled={state.limit5hUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limit5hUsdEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limit5hUsd}
            onChange={(e) => onChange({ limit5hUsd: e.target.value })}
            disabled={!state.limit5hUsdEnabled}
            placeholder={translations.placeholders.emptyNoLimit}
          />
        </FieldCard>

        <FieldCard
          title={translations.fields.limitWeekly}
          enabled={state.limitWeeklyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitWeeklyUsdEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitWeeklyUsd}
            onChange={(e) => onChange({ limitWeeklyUsd: e.target.value })}
            disabled={!state.limitWeeklyUsdEnabled}
            placeholder={translations.placeholders.emptyNoLimit}
          />
        </FieldCard>

        <FieldCard
          title={translations.fields.limitMonthly}
          enabled={state.limitMonthlyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitMonthlyUsdEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitMonthlyUsd}
            onChange={(e) => onChange({ limitMonthlyUsd: e.target.value })}
            disabled={!state.limitMonthlyUsdEnabled}
            placeholder={translations.placeholders.emptyNoLimit}
          />
        </FieldCard>
      </div>
    </div>
  );
}
