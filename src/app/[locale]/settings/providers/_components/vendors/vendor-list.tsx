"use client";

import { PackageOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProviderVendorSummary } from "@/repository/provider-vendor";
import { VendorCard } from "./vendor-card";

interface VendorListProps {
  vendors: ProviderVendorSummary[];
}

export function VendorList({ vendors }: VendorListProps) {
  const t = useTranslations("settings.providers.vendors");

  if (vendors.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-center">
        <PackageOpen className="mb-4 h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-medium">{t("empty.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {vendors.map((vendor) => (
        <VendorCard key={vendor.id} vendor={vendor} />
      ))}
    </div>
  );
}
