"use client";

import { RefreshCcw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface ViewSwitcherProps {
  legacyPath: string;
  modernPath: string;
}

export function ViewSwitcher({ legacyPath, modernPath }: ViewSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("common");

  const isModernView = pathname.includes(modernPath);
  const targetPath = isModernView ? legacyPath : modernPath;
  const label = isModernView ? t("switchToLegacy") : t("switchToModern");

  return (
    <Button variant="outline" size="sm" onClick={() => router.push(targetPath)}>
      <RefreshCcw className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}
