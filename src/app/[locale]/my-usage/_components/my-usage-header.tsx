"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { QuotaCountdownCompact } from "@/components/quota/quota-countdown";
import { Button } from "@/components/ui/button";
import { useCountdown } from "@/hooks/useCountdown";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";

interface MyUsageHeaderProps {
  onLogout?: () => Promise<void> | void;
  keyName?: string;
  userName?: string;
  keyExpiresAt?: Date | null;
  userExpiresAt?: Date | null;
}

export function MyUsageHeader({
  onLogout,
  keyName,
  userName,
  keyExpiresAt,
  userExpiresAt,
}: MyUsageHeaderProps) {
  const t = useTranslations("myUsage.header");
  const tExpiration = useTranslations("myUsage.expiration");
  const router = useRouter();

  const keyCountdown = useCountdown(keyExpiresAt ?? null, Boolean(keyExpiresAt));
  const userCountdown = useCountdown(userExpiresAt ?? null, Boolean(userExpiresAt));

  const renderCountdownChip = (
    label: string,
    expiresAt: Date | null | undefined,
    countdown: ReturnType<typeof useCountdown>
  ) => {
    if (!expiresAt || countdown.isExpired || countdown.totalSeconds > 7 * 24 * 60 * 60) return null;

    const tone = countdown.totalSeconds <= 24 * 60 * 60 ? "danger" : "warning";
    const toneClass =
      tone === "danger"
        ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100";

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
          toneClass
        )}
      >
        <span>{label}</span>
        <QuotaCountdownCompact resetAt={expiresAt} />
      </span>
    );
  };

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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-tight">{t("title")}</h1>
          {renderCountdownChip(tExpiration("keyExpires"), keyExpiresAt, keyCountdown)}
          {renderCountdownChip(tExpiration("userExpires"), userExpiresAt, userCountdown)}
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
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </Button>
      </div>
    </div>
  );
}
