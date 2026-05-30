"use client";

import { BookOpen, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/routing";

interface MyUsageHeaderProps {
  onLogout?: () => Promise<void> | void;
  keyName?: string;
  userName?: string;
}

export function MyUsageHeader({ onLogout, keyName, userName }: MyUsageHeaderProps) {
  const t = useTranslations("myUsage.header");
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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-tight">
            {userName ? t("welcome", { name: userName }) : t("title")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="text-foreground font-medium">{t("keyLabel")}:</span>
            <span>{keyName ?? "—"}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-foreground font-medium">{t("userLabel")}:</span>
            <span>{userName ?? "—"}</span>
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/usage-doc">
            <BookOpen className="h-4 w-4" />
            {t("documentation")}
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </Button>
      </div>
    </div>
  );
}
