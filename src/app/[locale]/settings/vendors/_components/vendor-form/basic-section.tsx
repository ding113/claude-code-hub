"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateVendor } from "@/actions/vendors";
import { Button } from "@/components/ui/button";
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
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import type { Vendor, VendorCategory } from "@/types/vendor";

interface BasicSectionProps {
  vendor: Vendor;
  onSaved?: () => void | Promise<void>;
}

export function BasicSection({ vendor, onSaved }: BasicSectionProps) {
  const t = useTranslations("vendors");
  const [pending, startTransition] = useTransition();

  const resetToVendor = () => {
    setName(vendor.name);
    setCategory(vendor.category);
    setDescription(vendor.description ?? "");
    setTags(vendor.tags ?? []);
    setWebsiteUrl(vendor.websiteUrl ?? "");
    setFaviconUrl(vendor.faviconUrl ?? "");
    setIsEnabled(vendor.isEnabled);
    setIsManaged(vendor.isManaged);
  };

  const [name, setName] = useState(vendor.name);
  const [category, setCategory] = useState<VendorCategory>(vendor.category);
  const [description, setDescription] = useState(vendor.description ?? "");
  const [tags, setTags] = useState<string[]>(vendor.tags ?? []);
  const [websiteUrl, setWebsiteUrl] = useState(vendor.websiteUrl ?? "");
  const [faviconUrl, setFaviconUrl] = useState(vendor.faviconUrl ?? "");
  const [isEnabled, setIsEnabled] = useState(vendor.isEnabled);
  const [isManaged, setIsManaged] = useState(vendor.isManaged);

  useEffect(() => {
    setName(vendor.name);
    setCategory(vendor.category);
    setDescription(vendor.description ?? "");
    setTags(vendor.tags ?? []);
    setWebsiteUrl(vendor.websiteUrl ?? "");
    setFaviconUrl(vendor.faviconUrl ?? "");
    setIsEnabled(vendor.isEnabled);
    setIsManaged(vendor.isManaged);
  }, [vendor]);

  const dirty = useMemo(() => {
    return (
      name !== vendor.name ||
      category !== vendor.category ||
      (description || null) !== vendor.description ||
      JSON.stringify(tags) !== JSON.stringify(vendor.tags ?? []) ||
      (websiteUrl || null) !== vendor.websiteUrl ||
      (faviconUrl || null) !== vendor.faviconUrl ||
      isEnabled !== vendor.isEnabled ||
      isManaged !== vendor.isManaged
    );
  }, [vendor, name, category, description, tags, websiteUrl, faviconUrl, isEnabled, isManaged]);

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateVendor(vendor.id, {
        name,
        category,
        description: description.trim() ? description.trim() : null,
        tags,
        websiteUrl: websiteUrl.trim() ? websiteUrl.trim() : null,
        faviconUrl: faviconUrl.trim() ? faviconUrl.trim() : null,
        isEnabled,
        isManaged,
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
      <div className="grid gap-2">
        <Label>{t("form.vendor.slug.label")}</Label>
        <Input value={vendor.slug} disabled />
        <p className="text-xs text-muted-foreground">{t("form.vendor.slug.help")}</p>
      </div>

      <div className="grid gap-2">
        <Label>{t("form.vendor.name.label")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.vendor.name.placeholder")}
          disabled={pending}
        />
      </div>

      <div className="grid gap-2">
        <Label>{t("category.label")}</Label>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as VendorCategory)}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("category.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="official">{t("category.options.official")}</SelectItem>
            <SelectItem value="relay">{t("category.options.relay")}</SelectItem>
            <SelectItem value="self_hosted">{t("category.options.self_hosted")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>{t("form.vendor.description.label")}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("form.vendor.description.placeholder")}
          disabled={pending}
        />
      </div>

      <div className="grid gap-2">
        <Label>{t("form.vendor.tags.label")}</Label>
        <TagInput
          value={tags}
          onChange={setTags}
          placeholder={t("form.vendor.tags.placeholder")}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">{t("form.vendor.tags.help")}</p>
      </div>

      <div className="grid gap-2">
        <Label>{t("form.vendor.websiteUrl.label")}</Label>
        <Input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder={t("form.vendor.websiteUrl.placeholder")}
          disabled={pending}
        />
      </div>

      <div className="grid gap-2">
        <Label>{t("form.vendor.faviconUrl.label")}</Label>
        <Input
          value={faviconUrl}
          onChange={(e) => setFaviconUrl(e.target.value)}
          placeholder={t("form.vendor.faviconUrl.placeholder")}
          disabled={pending}
        />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{t("form.vendor.isEnabled.label")}</div>
        </div>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={pending} />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{t("form.vendor.isManaged.label")}</div>
          <div className="text-xs text-muted-foreground">{t("form.vendor.isManaged.help")}</div>
        </div>
        <Switch checked={isManaged} onCheckedChange={setIsManaged} disabled={pending} />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={resetToVendor} disabled={pending || !dirty}>
          {t("actions.cancel")}
        </Button>
        <Button onClick={handleSave} disabled={pending || !dirty}>
          {t("actions.save")}
        </Button>
      </div>
    </div>
  );
}
