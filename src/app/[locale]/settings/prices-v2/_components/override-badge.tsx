"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

interface OverrideBadgeProps {
  isUserOverride: boolean;
}

export function OverrideBadge({ isUserOverride }: OverrideBadgeProps) {
  const t = useTranslations("prices-v2");

  if (!isUserOverride) return null;

  return <Badge variant="secondary">{t("table.isUserOverride")}</Badge>;
}
