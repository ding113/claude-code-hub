"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSystemSettings } from "@/actions/system-config";
import { toast } from "sonner";
import { CURRENCY_CONFIG } from "@/lib/utils";
import type { SystemSettings } from "@/types/system-config";
import type { CurrencyCode } from "@/lib/utils";

interface SystemSettingsFormProps {
  initialSettings: Pick<SystemSettings, "siteTitle" | "allowGlobalUsageView" | "currencyDisplay" | "allowViewProviderInfo" | "nonAdminCurrencyDisplay" | "nonAdminIgnoreMultiplier">;
}

export function SystemSettingsForm({ initialSettings }: SystemSettingsFormProps) {
  const [siteTitle, setSiteTitle] = useState(initialSettings.siteTitle);
  const [allowGlobalUsageView, setAllowGlobalUsageView] = useState(
    initialSettings.allowGlobalUsageView
  );
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyCode>(
    initialSettings.currencyDisplay
  );
  const [allowViewProviderInfo, setAllowViewProviderInfo] = useState(
    initialSettings.allowViewProviderInfo
  );
  const [nonAdminCurrencyDisplay, setNonAdminCurrencyDisplay] = useState<CurrencyCode>(
    initialSettings.nonAdminCurrencyDisplay
  );
  const [nonAdminIgnoreMultiplier, setNonAdminIgnoreMultiplier] = useState(
    initialSettings.nonAdminIgnoreMultiplier
  );
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!siteTitle.trim()) {
      toast.error("站点标题不能为空");
      return;
    }

    startTransition(async () => {
      const result = await saveSystemSettings({
        siteTitle,
        allowGlobalUsageView,
        currencyDisplay,
        allowViewProviderInfo,
        nonAdminCurrencyDisplay,
        nonAdminIgnoreMultiplier,
      });

      if (!result.ok) {
        toast.error(result.error || "保存失败");
        return;
      }

      if (result.data) {
        setSiteTitle(result.data.siteTitle);
        setAllowGlobalUsageView(result.data.allowGlobalUsageView);
        setCurrencyDisplay(result.data.currencyDisplay);
        setAllowViewProviderInfo(result.data.allowViewProviderInfo);
        setNonAdminCurrencyDisplay(result.data.nonAdminCurrencyDisplay);
        setNonAdminIgnoreMultiplier(result.data.nonAdminIgnoreMultiplier);
      }

      toast.success("系统设置已更新，页面将刷新以应用变更");
      // 刷新页面以应用配置变更
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="site-title">站点标题</Label>
        <Input
          id="site-title"
          value={siteTitle}
          onChange={(event) => setSiteTitle(event.target.value)}
          placeholder="例如：Claude Code Hub"
          disabled={isPending}
          maxLength={128}
          required
        />
        <p className="text-xs text-muted-foreground">
          用于设置浏览器标签页标题以及系统默认显示名称。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency-display">货币显示单位</Label>
        <Select
          value={currencyDisplay}
          onValueChange={(value) => setCurrencyDisplay(value as CurrencyCode)}
          disabled={isPending}
        >
          <SelectTrigger id="currency-display">
            <SelectValue placeholder="选择货币单位" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => {
              const config = CURRENCY_CONFIG[code];
              return (
                <SelectItem key={code} value={code}>
                  {config.symbol} {config.name} ({code})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          修改后，系统所有页面和 API
          接口的金额显示将使用对应的货币符号（仅修改符号，不进行汇率转换）。
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="allow-global-usage" className="text-sm font-medium">
            允许查看全站使用量
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            关闭后，普通用户在仪表盘仅能查看自己密钥的使用统计。
          </p>
        </div>
        <Switch
          id="allow-global-usage"
          checked={allowGlobalUsageView}
          onCheckedChange={(checked) => setAllowGlobalUsageView(checked)}
          disabled={isPending}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="allow-view-provider" className="text-sm font-medium">
            允许非管理员查看供应商信息
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            关闭后，普通用户将无法查看供应商名称和倍率信息，所有金额按倍率 1.0 显示。
          </p>
        </div>
        <Switch
          id="allow-view-provider"
          checked={allowViewProviderInfo}
          onCheckedChange={(checked) => setAllowViewProviderInfo(checked)}
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="non-admin-currency">非管理员用户货币显示单位</Label>
        <Select
          value={nonAdminCurrencyDisplay}
          onValueChange={(value) => setNonAdminCurrencyDisplay(value as CurrencyCode)}
          disabled={isPending}
        >
          <SelectTrigger id="non-admin-currency">
            <SelectValue placeholder="选择货币单位" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => {
              const config = CURRENCY_CONFIG[code];
              return (
                <SelectItem key={code} value={code}>
                  {config.symbol} {config.name} ({code})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          非管理员用户看到的货币符号（仅修改符号，不进行汇率转换）。
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-border px-4 py-3">
        <div>
          <Label htmlFor="non-admin-ignore-multiplier" className="text-sm font-medium">
            非管理员忽略所有渠道商倍率
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            开启后，非管理员看到的所有金额按倍率 1.0 计算（即原始成本，不包含渠道商倍率加成）。关闭后，显示实际金额（含倍率）。
          </p>
        </div>
        <Switch
          id="non-admin-ignore-multiplier"
          checked={nonAdminIgnoreMultiplier}
          onCheckedChange={(checked) => setNonAdminIgnoreMultiplier(checked)}
          disabled={isPending}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "保存中..." : "保存设置"}
        </Button>
      </div>
    </form>
  );
}
