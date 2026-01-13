"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { ProviderVendorSummary } from "@/repository/provider-vendor";
import { VendorList } from "./vendor-list";

interface VendorsManagerProps {
  initialVendors: ProviderVendorSummary[];
}

export function VendorsManager({ initialVendors }: VendorsManagerProps) {
  const t = useTranslations("settings.providers.vendors");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredVendors = initialVendors.filter(
    (vendor) =>
      vendor.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vendor.vendorKey.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <VendorList vendors={filteredVendors} />
    </div>
  );
}
