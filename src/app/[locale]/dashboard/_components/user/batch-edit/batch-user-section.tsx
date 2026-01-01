"use client";

import { Input } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { FieldCard } from "./field-card";
import { formatMessage } from "./utils";

export interface BatchUserSectionState {
  noteEnabled: boolean;
  note: string;
  tagsEnabled: boolean;
  tags: string[];
  rpmEnabled: boolean;
  rpm: string;
  limit5hUsdEnabled: boolean;
  limit5hUsd: string;
  dailyQuotaEnabled: boolean;
  dailyQuota: string;
  limitWeeklyUsdEnabled: boolean;
  limitWeeklyUsd: string;
  limitMonthlyUsdEnabled: boolean;
  limitMonthlyUsd: string;
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
      rpm: string;
      limit5h: string;
      limitDaily: string;
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
          title={translations.fields.rpm}
          enabled={state.rpmEnabled}
          onEnabledChange={(enabled) => onChange({ rpmEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={state.rpm}
            onChange={(e) => onChange({ rpm: e.target.value })}
            disabled={!state.rpmEnabled}
            placeholder={translations.placeholders.emptyNoLimit}
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
          title={translations.fields.limitDaily}
          enabled={state.dailyQuotaEnabled}
          onEnabledChange={(enabled) => onChange({ dailyQuotaEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.dailyQuota}
            onChange={(e) => onChange({ dailyQuota: e.target.value })}
            disabled={!state.dailyQuotaEnabled}
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
