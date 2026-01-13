"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Globe, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { editProviderVendor } from "@/actions/provider-vendors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ProviderVendorSummary } from "@/repository/provider-vendor";
import { VendorEditSheet } from "./vendor-edit-sheet";

export function VendorCard({ vendor }: { vendor: ProviderVendorSummary }) {
  const t = useTranslations("settings.providers.vendors");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleToggle = async (enabled: boolean) => {
    const result = await editProviderVendor(vendor.id, { isEnabled: enabled });
    if (result.ok) {
      queryClient.invalidateQueries({ queryKey: ["provider-vendors"] });
      toast.success(t("actions.updated"));
    } else {
      toast.error(t("errors.updateFailed"));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {vendor.faviconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vendor.faviconUrl} alt="" className="h-5 w-5 rounded-sm" />
          ) : (
            <Globe className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="font-semibold">{vendor.displayName}</span>
        </div>
        <Switch checked={vendor.isEnabled} onCheckedChange={handleToggle} />
      </CardHeader>
      <CardContent className="space-y-2 pb-2">
        <div className="flex gap-2">
          <Badge variant="secondary">
            {vendor.providerCount} {t("stats.providers")}
          </Badge>
          <Badge variant="outline">
            {vendor.endpointCount} {t("stats.endpoints")}
          </Badge>
        </div>
      </CardContent>
      <CardFooter className="pt-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setIsEditOpen(true)}>
          <Settings2 className="mr-2 h-4 w-4" />
          {t("actions.configure")}
        </Button>
        <VendorEditSheet open={isEditOpen} onOpenChange={setIsEditOpen} vendor={vendor} />
      </CardFooter>
    </Card>
  );
}
