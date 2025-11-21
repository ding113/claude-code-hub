import { Link } from "@/i18n/routing";

import type { AuthSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DashboardNav, type DashboardNavItem } from "./dashboard-nav";
import { UserMenu } from "./user-menu";
import { VersionUpdateNotifier } from "@/components/customs/version-update-notifier";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { useTranslations } from "next-intl";

interface DashboardHeaderProps {
  session: AuthSession | null;
}

export function DashboardHeader({ session }: DashboardHeaderProps) {
  const t = useTranslations("dashboard.nav");
  const isAdmin = session?.user.role === "admin";

  const NAV_ITEMS: (DashboardNavItem & { adminOnly?: boolean })[] = [
    { href: "/dashboard", label: t("dashboard") },
    { href: "/dashboard/logs", label: t("usageLogs") },
    { href: "/dashboard/leaderboard", label: t("leaderboard") },
    { href: "/dashboard/quotas", label: t("quotasManagement") },
    { href: "/dashboard/users", label: t("userManagement") },
    { href: "/usage-doc", label: t("documentation") },
    { href: "/settings", label: t("systemSettings"), adminOnly: true },
  ];

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
        <DashboardNav items={items} />
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <LanguageSwitcher size="sm" />
          {session && <VersionUpdateNotifier />}
          {session ? (
            <UserMenu user={session.user} />
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/login">{t("login")}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
