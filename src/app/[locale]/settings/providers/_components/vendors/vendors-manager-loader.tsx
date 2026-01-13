"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getProviderVendors } from "@/actions/provider-vendors";
import { VendorsManager } from "./vendors-manager";

export function VendorsManagerLoader() {
  const { data: vendors, isLoading } = useQuery({
    queryKey: ["provider-vendors"],
    queryFn: () => getProviderVendors(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <VendorsManager initialVendors={vendors || []} />;
}
