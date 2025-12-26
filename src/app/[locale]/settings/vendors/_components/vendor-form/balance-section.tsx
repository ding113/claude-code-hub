"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateVendor } from "@/actions/vendors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Vendor } from "@/types/vendor";

interface BalanceSectionProps {
  vendor: Vendor;
  onSaved?: () => void | Promise<void>;
}

export function BalanceSection({ vendor, onSaved }: BalanceSectionProps) {
  const t = useTranslations("vendors");
  const [pending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(vendor.balanceCheckEnabled);
  const [endpoint, setEndpoint] = useState(vendor.balanceCheckEndpoint ?? "");
  const [jsonpath, setJsonpath] = useState(vendor.balanceCheckJsonpath ?? "");
  const [intervalSeconds, setIntervalSeconds] = useState<number | "">(
    vendor.balanceCheckIntervalSeconds ?? ""
  );
  const [lowThresholdUsd, setLowThresholdUsd] = useState<number | "">(
    vendor.balanceCheckLowThresholdUsd ?? ""
  );

  useEffect(() => {
    setEnabled(vendor.balanceCheckEnabled);
    setEndpoint(vendor.balanceCheckEndpoint ?? "");
    setJsonpath(vendor.balanceCheckJsonpath ?? "");
    setIntervalSeconds(vendor.balanceCheckIntervalSeconds ?? "");
    setLowThresholdUsd(vendor.balanceCheckLowThresholdUsd ?? "");
  }, [vendor]);

  const dirty = useMemo(() => {
    return (
      enabled !== vendor.balanceCheckEnabled ||
      (endpoint || null) !== vendor.balanceCheckEndpoint ||
      (jsonpath || null) !== vendor.balanceCheckJsonpath ||
      (intervalSeconds === "" ? null : intervalSeconds) !== vendor.balanceCheckIntervalSeconds ||
      (lowThresholdUsd === "" ? null : lowThresholdUsd) !== vendor.balanceCheckLowThresholdUsd
    );
  }, [vendor, enabled, endpoint, jsonpath, intervalSeconds, lowThresholdUsd]);

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateVendor(vendor.id, {
        balanceCheckEnabled: enabled,
        balanceCheckEndpoint: endpoint.trim() ? endpoint.trim() : null,
        balanceCheckJsonpath: jsonpath.trim() ? jsonpath.trim() : null,
        balanceCheckIntervalSeconds: intervalSeconds === "" ? null : intervalSeconds,
        balanceCheckLowThresholdUsd: lowThresholdUsd === "" ? null : lowThresholdUsd,
      });

      if (!res.ok) {
        toast.error(t("errors.saveFailed"), { description: res.error });
        return;
      }

      toast.success(t("messages.updateSuccess"));
      await onSaved?.();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{t("form.balanceCheck.enabled.label")}</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={pending} />
      </div>

      <div className="grid gap-2">
        <Label>{t("form.balanceCheck.endpoint.label")}</Label>
        <Input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder={t("form.balanceCheck.endpoint.placeholder")}
          disabled={pending || !enabled}
        />
      </div>

      <div className="grid gap-2">
        <Label>{t("form.balanceCheck.jsonpath.label")}</Label>
        <Input
          value={jsonpath}
          onChange={(e) => setJsonpath(e.target.value)}
          placeholder={t("form.balanceCheck.jsonpath.placeholder")}
          disabled={pending || !enabled}
        />
        <p className="text-xs text-muted-foreground">{t("form.balanceCheck.jsonpath.help")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>{t("form.balanceCheck.intervalSeconds.label")}</Label>
          <Input
            type="number"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(e.target.value ? Number(e.target.value) : "")}
            placeholder={t("form.balanceCheck.intervalSeconds.placeholder")}
            disabled={pending || !enabled}
          />
        </div>

        <div className="grid gap-2">
          <Label>{t("form.balanceCheck.lowThresholdUsd.label")}</Label>
          <Input
            type="number"
            value={lowThresholdUsd}
            onChange={(e) => setLowThresholdUsd(e.target.value ? Number(e.target.value) : "")}
            placeholder={t("form.balanceCheck.lowThresholdUsd.placeholder")}
            disabled={pending || !enabled}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={pending || !dirty}>
          {t("actions.save")}
        </Button>
      </div>
    </div>
  );
}
