"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { VendorKeyDisplay } from "@/actions/vendors";
import { createVendorKey, updateVendorKey } from "@/actions/vendors";
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
import type { ProviderType } from "@/types/provider";
import type { VendorEndpoint } from "@/types/vendor";

type Mode = "create" | "edit";

interface KeyFormProps {
  mode: Mode;
  vendorId: number;
  endpoints: VendorEndpoint[];
  vendorKey?: VendorKeyDisplay;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
}

const PROVIDER_TYPES: ProviderType[] = [
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
];

function defaultProviderTypeForEndpoint(endpoint: VendorEndpoint | undefined): ProviderType {
  if (!endpoint) return "claude";
  if (endpoint.apiFormat === "codex") return "codex";
  if (endpoint.apiFormat === "gemini") return "gemini";
  return "claude";
}

export function KeyForm({
  mode,
  vendorId,
  endpoints,
  vendorKey,
  open,
  onOpenChange,
  onSaved,
}: KeyFormProps) {
  const t = useTranslations("vendors");
  const [pending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const [endpointId, setEndpointId] = useState<number>(
    vendorKey?.endpointId ?? endpoints[0]?.id ?? 0
  );
  const selectedEndpoint = endpoints.find((e) => e.id === endpointId);

  const [name, setName] = useState(vendorKey?.name ?? "");
  const [description, setDescription] = useState(vendorKey?.description ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [url, setUrl] = useState(vendorKey?.url ?? selectedEndpoint?.url ?? "");
  const [providerType, setProviderType] = useState<ProviderType>(
    vendorKey?.providerType ?? defaultProviderTypeForEndpoint(selectedEndpoint)
  );
  const [groupTag, setGroupTag] = useState(vendorKey?.groupTag ?? "");
  const [priority, setPriority] = useState<number>(vendorKey?.priority ?? 0);
  const [weight, setWeight] = useState<number>(vendorKey?.weight ?? 1);
  const [costMultiplier, setCostMultiplier] = useState<number>(vendorKey?.costMultiplier ?? 1);
  const [isEnabled, setIsEnabled] = useState(vendorKey?.isEnabled ?? true);
  const [isUserOverride, setIsUserOverride] = useState(vendorKey?.isUserOverride ?? true);

  useEffect(() => {
    if (!open) return;
    setEndpointId(vendorKey?.endpointId ?? endpoints[0]?.id ?? 0);
    setName(vendorKey?.name ?? "");
    setDescription(vendorKey?.description ?? "");
    setKeySecret("");
    setUrl(vendorKey?.url ?? selectedEndpoint?.url ?? "");
    setProviderType(vendorKey?.providerType ?? defaultProviderTypeForEndpoint(selectedEndpoint));
    setGroupTag(vendorKey?.groupTag ?? "");
    setPriority(vendorKey?.priority ?? 0);
    setWeight(vendorKey?.weight ?? 1);
    setCostMultiplier(vendorKey?.costMultiplier ?? 1);
    setIsEnabled(vendorKey?.isEnabled ?? true);
    setIsUserOverride(vendorKey?.isUserOverride ?? true);
  }, [open, vendorKey, endpoints, selectedEndpoint]);

  useEffect(() => {
    if (!selectedEndpoint) return;
    if (!vendorKey) {
      setUrl(selectedEndpoint.url);
      setProviderType(defaultProviderTypeForEndpoint(selectedEndpoint));
    }
  }, [selectedEndpoint, vendorKey]);

  const dirty = useMemo(() => {
    if (!isEdit || !vendorKey) return true;
    return (
      endpointId !== vendorKey.endpointId ||
      name !== vendorKey.name ||
      (description || null) !== vendorKey.description ||
      url !== vendorKey.url ||
      providerType !== vendorKey.providerType ||
      (groupTag || null) !== vendorKey.groupTag ||
      priority !== vendorKey.priority ||
      weight !== vendorKey.weight ||
      costMultiplier !== vendorKey.costMultiplier ||
      isEnabled !== vendorKey.isEnabled ||
      isUserOverride !== vendorKey.isUserOverride ||
      keySecret.trim().length > 0
    );
  }, [
    isEdit,
    vendorKey,
    endpointId,
    name,
    description,
    url,
    providerType,
    groupTag,
    priority,
    weight,
    costMultiplier,
    isEnabled,
    isUserOverride,
    keySecret,
  ]);

  const handleSubmit = () => {
    startTransition(async () => {
      const basePayload = {
        vendorId,
        endpointId,
        name,
        description: description.trim() ? description.trim() : null,
        url,
        providerType,
        groupTag: groupTag.trim() ? groupTag.trim() : null,
        priority,
        weight,
        costMultiplier,
        isEnabled,
        isUserOverride,
      };

      const res =
        isEdit && vendorKey
          ? await updateVendorKey(vendorKey.id, {
              ...basePayload,
              ...(keySecret.trim() ? { key: keySecret.trim() } : {}),
            })
          : await createVendorKey({
              ...basePayload,
              key: keySecret.trim(),
            });

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("actions.edit") : t("actions.newKey")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("form.key.endpointId.label")}</Label>
            <Select
              value={String(endpointId)}
              onValueChange={(v) => setEndpointId(Number(v))}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("form.key.endpointId.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("form.key.name.label")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("form.key.name.placeholder")}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.key.providerType.label")}</Label>
              <Select
                value={providerType}
                onValueChange={(v) => setProviderType(v as ProviderType)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("form.key.providerType.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("form.key.key.label")}</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder={t("form.key.key.placeholder")}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">{t("form.key.key.help")}</p>
          </div>

          <div className="grid gap-2">
            <Label>{t("form.key.url.label")}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("form.key.url.placeholder")}
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>{t("form.key.groupTag.label")}</Label>
              <Input
                value={groupTag}
                onChange={(e) => setGroupTag(e.target.value)}
                placeholder={t("form.key.groupTag.placeholder")}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.key.priority.label")}</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value || 0))}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.key.weight.label")}</Label>
              <Input
                type="number"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value || 1))}
                disabled={pending}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("form.key.costMultiplier.label")}</Label>
              <Input
                type="number"
                value={costMultiplier}
                onChange={(e) => setCostMultiplier(Number(e.target.value || 1))}
                disabled={pending}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("form.vendor.description.label")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("form.vendor.description.placeholder")}
              disabled={pending}
            />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">{t("form.key.isEnabled.label")}</div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={pending} />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t("form.key.isUserOverride.label")}</div>
              <div className="text-xs text-muted-foreground">
                {t("form.key.isUserOverride.help")}
              </div>
            </div>
            <Switch
              checked={isUserOverride}
              onCheckedChange={setIsUserOverride}
              disabled={pending}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                pending || !dirty || !name.trim() || !url.trim() || (!isEdit && !keySecret.trim())
              }
            >
              {t("actions.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
