"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { VendorBundle } from "@/actions/vendors";
import { VendorCard } from "./vendor-card";

interface VendorListProps {
  bundles: VendorBundle[];
}

export function VendorList({ bundles }: VendorListProps) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");

  if (bundles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Building2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">{tc("noData")}</h3>
        <p className="text-sm text-muted-foreground text-center">{t("page.description")}</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {bundles.map((bundle) => (
        <VendorCard key={bundle.vendor.id} bundle={bundle} />
      ))}
    </div>
  );
}
