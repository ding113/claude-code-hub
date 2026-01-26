"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FieldCard } from "./field-card";
import { formatMessage } from "./utils";

export interface BatchKeySectionState {
  providerGroupEnabled: boolean;
  providerGroup: string;
  limit5hUsdEnabled: boolean;
  limit5hUsd: string;
  limitDailyUsdEnabled: boolean;
  limitDailyUsd: string;
  limitWeeklyUsdEnabled: boolean;
  limitWeeklyUsd: string;
  limitMonthlyUsdEnabled: boolean;
  limitMonthlyUsd: string;
  canLoginWebUiEnabled: boolean;
  canLoginWebUi: boolean;
  isEnabledEnabled: boolean;
  isEnabled: boolean;
}

export interface BatchKeySectionProps {
  affectedKeysCount: number;
  state: BatchKeySectionState;
  onChange: (patch: Partial<BatchKeySectionState>) => void;
  translations: {
    title: string;
    affected: string;
    enableFieldAria: string;
    fields: {
      providerGroup: string;
      limit5h: string;
      limitDaily: string;
      limitWeekly: string;
      limitMonthly: string;
      canLoginWebUi: string;
      keyEnabled: string;
    };
    placeholders: {
      groupPlaceholder: string;
      emptyNoLimit: string;
    };
    targetValue: string;
  };
}

export function BatchKeySection({
  affectedKeysCount,
  state,
  onChange,
  translations,
}: BatchKeySectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">{translations.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatMessage(translations.affected, { count: affectedKeysCount })}
        </div>
      </div>

      <div className="space-y-3">
        <FieldCard
          title={translations.fields.providerGroup}
          enabled={state.providerGroupEnabled}
          onEnabledChange={(enabled) => onChange({ providerGroupEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            value={state.providerGroup}
            onChange={(e) => onChange({ providerGroup: e.target.value })}
            disabled={!state.providerGroupEnabled}
            placeholder={translations.placeholders.groupPlaceholder}
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
          enabled={state.limitDailyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitDailyUsdEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitDailyUsd}
            onChange={(e) => onChange({ limitDailyUsd: e.target.value })}
            disabled={!state.limitDailyUsdEnabled}
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

        {/* Balance Query Page toggle uses inverted logic by design:
            - canLoginWebUi=true means user accesses full WebUI (switch OFF)
            - canLoginWebUi=false means user uses independent balance page (switch ON)
            The switch represents "enable independent page" which is !canLoginWebUi */}
        <FieldCard
          title={translations.fields.canLoginWebUi}
          enabled={state.canLoginWebUiEnabled}
          onEnabledChange={(enabled) => onChange({ canLoginWebUiEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{translations.targetValue}</span>
            <Switch
              checked={!state.canLoginWebUi}
              onCheckedChange={(checked) => onChange({ canLoginWebUi: !checked })}
              disabled={!state.canLoginWebUiEnabled}
              aria-label={`${translations.targetValue}: ${translations.fields.canLoginWebUi}`}
            />
          </div>
        </FieldCard>

        <FieldCard
          title={translations.fields.keyEnabled}
          enabled={state.isEnabledEnabled}
          onEnabledChange={(enabled) => onChange({ isEnabledEnabled: enabled })}
          enableFieldAria={translations.enableFieldAria}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{translations.targetValue}</span>
            <Switch
              checked={state.isEnabled}
              onCheckedChange={(checked) => onChange({ isEnabled: checked })}
              disabled={!state.isEnabledEnabled}
              aria-label={`${translations.targetValue}: ${translations.fields.keyEnabled}`}
            />
          </div>
        </FieldCard>
      </div>
    </div>
  );
}
