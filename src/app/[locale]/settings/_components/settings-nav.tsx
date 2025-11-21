"use client";

import { Link, usePathname } from "@/i18n/routing";

import { cn } from "@/lib/utils";
import type { SettingsNavItem } from "../_lib/nav-items";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { useTranslations } from "next-intl";

interface SettingsNavProps {
  items: SettingsNavItem[];
}

export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname();
  const t = useTranslations("common");

  if (items.length === 0) {
    return null;
  }

  const getIsActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="rounded-xl border border-border/80 bg-card/70 p-1 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = getIsActive(item.href);
          const linkClassName = cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
            isActive && "bg-primary/5 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          );

          return (
            <li key={item.href}>
              {item.external ? (
                // External link: use native <a> tag, open in new tab
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                >
                  <span>{item.label}</span>
                  <svg
                    className="h-3 w-3 opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              ) : (
                // Internal link: use i18n Link
                <Link href={item.href} className={linkClassName}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 rounded-lg border border-dashed border-border/80 bg-muted/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("appearance")}
            </p>
            <p className="text-sm text-foreground/90">{t("theme")}</p>
          </div>
          <ThemeSwitcher />
        </div>
      </div>
    </nav>
  );
}
