"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { editProviderVendor } from "@/actions/provider-vendors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProviderVendorSummary } from "@/repository/provider-vendor";
import { VendorEndpointsManager } from "./vendor-endpoints-manager";

interface VendorEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: ProviderVendorSummary;
}

export function VendorEditSheet({ open, onOpenChange, vendor }: VendorEditSheetProps) {
  const t = useTranslations("settings.providers.vendors");
  const [displayName, setDisplayName] = useState(vendor.displayName);
  const [websiteUrl, setWebsiteUrl] = useState(vendor.websiteUrl || "");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await editProviderVendor(vendor.id, {
        displayName,
        websiteUrl: websiteUrl || null,
      });

      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
        toast.success(t("actions.updated"));
        onOpenChange(false);
      } else {
        toast.error(t("errors.updateFailed"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("edit.title")}</SheetTitle>
          <SheetDescription>{t("edit.description")}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t("fields.name")}</Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="website">{t("fields.website")}</Label>
              <Input
                id="website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>
            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t("endpoints.title")}</h3>
            <VendorEndpointsManager vendorId={vendor.id} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
