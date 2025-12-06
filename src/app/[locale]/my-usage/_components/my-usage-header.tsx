"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/routing";

interface MyUsageHeaderProps {
  onLogout?: () => Promise<void> | void;
}

export function MyUsageHeader({ onLogout }: MyUsageHeaderProps) {
  const t = useTranslations("myUsage");
  const router = useRouter();

  const handleLogout = async () => {
    if (onLogout) {
      await onLogout();
      return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold leading-tight">{t("header.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("header.subtitle")}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
        <LogOut className="h-4 w-4" />
        {t("header.logout")}
      </Button>
    </div>
  );
}
