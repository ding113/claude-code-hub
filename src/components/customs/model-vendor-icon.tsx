"use client";

import { getModelVendor } from "@/lib/model-vendor-icons";

interface ModelVendorIconProps {
  modelId: string;
  className?: string;
}

export function ModelVendorIcon({
  modelId,
  className = "h-3.5 w-3.5 shrink-0",
}: ModelVendorIconProps) {
  const vendor = getModelVendor(modelId);
  if (!vendor) return null;
  const Icon = vendor.icon;
  return <Icon className={className} />;
}
