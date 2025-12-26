"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createVendorEndpoint, updateVendorEndpoint } from "@/actions/vendors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { VendorApiFormat, VendorEndpoint } from "@/types/vendor";

type Mode = "create" | "edit";

interface EndpointFormProps {
  mode: Mode;
  vendorId: number;
  endpoint?: VendorEndpoint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
}

export function EndpointForm({
  mode,
  vendorId,
  endpoint,
  open,
  onOpenChange,
  onSaved,
}: EndpointFormProps) {
  const t = useTranslations("vendors");
  const [pending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const [name, setName] = useState(endpoint?.name ?? "");
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [apiFormat, setApiFormat] = useState<VendorApiFormat>(endpoint?.apiFormat ?? "claude");
  const [priority, setPriority] = useState<number>(endpoint?.priority ?? 0);
  const [isEnabled, setIsEnabled] = useState(endpoint?.isEnabled ?? true);
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(
    endpoint?.healthCheckEnabled ?? false
  );
  const [healthCheckEndpoint, setHealthCheckEndpoint] = useState(
    endpoint?.healthCheckEndpoint ?? ""
  );
  const [healthCheckIntervalSeconds, setHealthCheckIntervalSeconds] = useState<number | "">(
    endpoint?.healthCheckIntervalSeconds ?? ""
  );
  const [healthCheckTimeoutMs, setHealthCheckTimeoutMs] = useState<number | "">(
    endpoint?.healthCheckTimeoutMs ?? ""
  );

  useEffect(() => {
    if (!open) return;
    setName(endpoint?.name ?? "");
    setUrl(endpoint?.url ?? "");
    setApiFormat(endpoint?.apiFormat ?? "claude");
    setPriority(endpoint?.priority ?? 0);
    setIsEnabled(endpoint?.isEnabled ?? true);
    setHealthCheckEnabled(endpoint?.healthCheckEnabled ?? false);
    setHealthCheckEndpoint(endpoint?.healthCheckEndpoint ?? "");
    setHealthCheckIntervalSeconds(endpoint?.healthCheckIntervalSeconds ?? "");
    setHealthCheckTimeoutMs(endpoint?.healthCheckTimeoutMs ?? "");
  }, [open, endpoint]);

  const dirty = useMemo(() => {
    if (!isEdit || !endpoint) return true;
    return (
      name !== endpoint.name ||
      url !== endpoint.url ||
      apiFormat !== endpoint.apiFormat ||
      priority !== endpoint.priority ||
      isEnabled !== endpoint.isEnabled ||
      healthCheckEnabled !== endpoint.healthCheckEnabled ||
      (healthCheckEndpoint || null) !== endpoint.healthCheckEndpoint ||
      (healthCheckIntervalSeconds === "" ? null : healthCheckIntervalSeconds) !==
        endpoint.healthCheckIntervalSeconds ||
      (healthCheckTimeoutMs === "" ? null : healthCheckTimeoutMs) !== endpoint.healthCheckTimeoutMs
    );
  }, [
    isEdit,
    endpoint,
    name,
    url,
    apiFormat,
    priority,
    isEnabled,
    healthCheckEnabled,
    healthCheckEndpoint,
    healthCheckIntervalSeconds,
    healthCheckTimeoutMs,
  ]);

  const handleSubmit = () => {
    startTransition(async () => {
      const payload = {
        vendorId,
        name,
        url,
        apiFormat,
        priority,
        isEnabled,
        healthCheckEnabled,
        healthCheckEndpoint: healthCheckEndpoint.trim() ? healthCheckEndpoint.trim() : null,
        healthCheckIntervalSeconds:
          healthCheckIntervalSeconds === "" ? null : healthCheckIntervalSeconds,
        healthCheckTimeoutMs: healthCheckTimeoutMs === "" ? null : healthCheckTimeoutMs,
      };

      const res =
        isEdit && endpoint
          ? await updateVendorEndpoint(endpoint.id, payload)
          : await createVendorEndpoint(payload);
      if (!res.ok) {
        toast.error(t("errors.saveFailed"), { description: res.error });
        return;
      }

      toast.success(t("messages.updateSuccess"));
      onOpenChange(false);
      await onSaved?.();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("actions.edit") : t("actions.newEndpoint")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("form.endpoint.name.label")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.endpoint.name.placeholder")}
              disabled={pending}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("form.endpoint.url.label")}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("form.endpoint.url.placeholder")}
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("apiFormat.label")}</Label>
              <Select
                value={apiFormat}
                onValueChange={(v) => setApiFormat(v as VendorApiFormat)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("apiFormat.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">{t("apiFormat.options.claude")}</SelectItem>
                  <SelectItem value="codex">{t("apiFormat.options.codex")}</SelectItem>
                  <SelectItem value="gemini">{t("apiFormat.options.gemini")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("form.endpoint.priority.label")}</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value || 0))}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">{t("form.endpoint.priority.help")}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">{t("form.endpoint.isEnabled.label")}</div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={pending} />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">{t("form.endpoint.healthCheckEnabled.label")}</div>
            <Switch
              checked={healthCheckEnabled}
              onCheckedChange={setHealthCheckEnabled}
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label>{t("form.endpoint.healthCheckEndpoint.label")}</Label>
              <Input
                value={healthCheckEndpoint}
                onChange={(e) => setHealthCheckEndpoint(e.target.value)}
                placeholder={t("form.endpoint.healthCheckEndpoint.placeholder")}
                disabled={pending || !healthCheckEnabled}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.endpoint.healthCheckIntervalSeconds.label")}</Label>
              <Input
                type="number"
                value={healthCheckIntervalSeconds}
                onChange={(e) =>
                  setHealthCheckIntervalSeconds(e.target.value ? Number(e.target.value) : "")
                }
                placeholder={t("form.endpoint.healthCheckIntervalSeconds.placeholder")}
                disabled={pending || !healthCheckEnabled}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.endpoint.healthCheckTimeoutMs.label")}</Label>
              <Input
                type="number"
                value={healthCheckTimeoutMs}
                onChange={(e) =>
                  setHealthCheckTimeoutMs(e.target.value ? Number(e.target.value) : "")
                }
                placeholder={t("form.endpoint.healthCheckTimeoutMs.placeholder")}
                disabled={pending || !healthCheckEnabled}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={pending || !dirty || !name.trim() || !url.trim()}
            >
              {t("actions.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
