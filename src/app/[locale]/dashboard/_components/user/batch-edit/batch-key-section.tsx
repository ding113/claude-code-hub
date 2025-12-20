"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
}

function FieldCard({
  title,
  enabled,
  onEnabledChange,
  children,
}: {
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-md border p-3 space-y-3", !enabled && "opacity-80")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={`启用字段：${title}`}
        />
      </div>
      {children}
    </div>
  );
}

export function BatchKeySection({ affectedKeysCount, state, onChange }: BatchKeySectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">密钥设置</div>
        <div className="text-xs text-muted-foreground">将影响 {affectedKeysCount} 个密钥</div>
      </div>

      <div className="space-y-3">
        <FieldCard
          title="分组 (providerGroup)"
          enabled={state.providerGroupEnabled}
          onEnabledChange={(enabled) => onChange({ providerGroupEnabled: enabled })}
        >
          <Input
            value={state.providerGroup}
            onChange={(e) => onChange({ providerGroup: e.target.value })}
            disabled={!state.providerGroupEnabled}
            placeholder="留空表示清空分组，多个用逗号分隔"
          />
        </FieldCard>

        <FieldCard
          title="5h 限额 (USD)"
          enabled={state.limit5hUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limit5hUsdEnabled: enabled })}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limit5hUsd}
            onChange={(e) => onChange({ limit5hUsd: e.target.value })}
            disabled={!state.limit5hUsdEnabled}
            placeholder="留空表示不限额"
          />
        </FieldCard>

        <FieldCard
          title="每日限额 (USD)"
          enabled={state.limitDailyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitDailyUsdEnabled: enabled })}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitDailyUsd}
            onChange={(e) => onChange({ limitDailyUsd: e.target.value })}
            disabled={!state.limitDailyUsdEnabled}
            placeholder="留空表示不限额"
          />
        </FieldCard>

        <FieldCard
          title="周限额 (USD)"
          enabled={state.limitWeeklyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitWeeklyUsdEnabled: enabled })}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitWeeklyUsd}
            onChange={(e) => onChange({ limitWeeklyUsd: e.target.value })}
            disabled={!state.limitWeeklyUsdEnabled}
            placeholder="留空表示不限额"
          />
        </FieldCard>

        <FieldCard
          title="月限额 (USD)"
          enabled={state.limitMonthlyUsdEnabled}
          onEnabledChange={(enabled) => onChange({ limitMonthlyUsdEnabled: enabled })}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={state.limitMonthlyUsd}
            onChange={(e) => onChange({ limitMonthlyUsd: e.target.value })}
            disabled={!state.limitMonthlyUsdEnabled}
            placeholder="留空表示不限额"
          />
        </FieldCard>

        <FieldCard
          title="允许登录 Web UI"
          enabled={state.canLoginWebUiEnabled}
          onEnabledChange={(enabled) => onChange({ canLoginWebUiEnabled: enabled })}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">目标值</span>
            <Switch
              checked={state.canLoginWebUi}
              onCheckedChange={(checked) => onChange({ canLoginWebUi: checked })}
              disabled={!state.canLoginWebUiEnabled}
              aria-label="目标值：允许登录 Web UI"
            />
          </div>
        </FieldCard>

        <FieldCard
          title="Key 启用状态"
          enabled={state.isEnabledEnabled}
          onEnabledChange={(enabled) => onChange({ isEnabledEnabled: enabled })}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">目标值</span>
            <Switch
              checked={state.isEnabled}
              onCheckedChange={(checked) => onChange({ isEnabled: checked })}
              disabled={!state.isEnabledEnabled}
              aria-label="目标值：Key 启用状态"
            />
          </div>
        </FieldCard>
      </div>
    </div>
  );
}
