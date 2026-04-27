"use client";

import { Check, Languages } from "lucide-react";
import { useLocale } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Locale, localeLabels, locales } from "@/i18n/config";
import { normalizePathnameForLocaleNavigation } from "@/i18n/pathname";
import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils/index";

const pendingLocaleRefreshKey = "cch.pendingLocaleRefresh";
let activePendingLocaleRefreshTarget: Locale | null = null;

interface LanguageSwitcherProps {
  className?: string;
  size?: "sm" | "default";
}

function getPendingLocaleRefreshTarget(): Locale | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.sessionStorage.getItem(pendingLocaleRefreshKey);
    return locales.some((locale) => locale === value) ? (value as Locale) : null;
  } catch {
    return null;
  }
}

function setPendingLocaleRefreshTarget(locale: Locale) {
  activePendingLocaleRefreshTarget = locale;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(pendingLocaleRefreshKey, locale);
  } catch {
    // 存储失败不影响路由切换，只会跳过额外的 RSC 刷新兜底。
  }
}

function clearPendingLocaleRefreshTarget() {
  activePendingLocaleRefreshTarget = null;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(pendingLocaleRefreshKey);
  } catch {
    // 清理失败可忽略，下一次读取会重新校验 locale 是否有效。
  }
}

/**
 * LanguageSwitcher Component
 *
 * Provides a dropdown UI for switching between supported locales.
 * Automatically persists locale preference via cookie and maintains current route.
 */
export function LanguageSwitcher({ className, size = "sm" }: LanguageSwitcherProps) {
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, setIsTransitioning] = React.useState(false);
  const [pendingLocale, setPendingLocale] = React.useState<Locale | null>(null);

  React.useEffect(() => {
    const storedRefreshTarget =
      pendingLocale !== null || activePendingLocaleRefreshTarget !== null
        ? getPendingLocaleRefreshTarget()
        : null;
    const refreshTarget = pendingLocale ?? storedRefreshTarget;

    if (refreshTarget !== currentLocale) {
      return;
    }

    // Locale route 已切换后刷新当前 RSC 树，避免布局与服务端标题继续显示旧语言。
    router.refresh();
    clearPendingLocaleRefreshTarget();
    setPendingLocale(null);
    setIsTransitioning(false);
  }, [currentLocale, pendingLocale, router]);

  const handleLocaleChange = React.useCallback(
    (newLocale: Locale) => {
      if (newLocale === currentLocale || isTransitioning) {
        return;
      }

      setIsTransitioning(true);
      setPendingLocale(newLocale);
      setPendingLocaleRefreshTarget(newLocale);

      try {
        router.push(normalizePathnameForLocaleNavigation(pathname), { locale: newLocale });
      } catch (error) {
        console.error("Failed to switch locale:", error);
        clearPendingLocaleRefreshTarget();
        setPendingLocale(null);
        setIsTransitioning(false);
      }
    },
    [currentLocale, pathname, router, isTransitioning]
  );

  const buttonSize = size === "sm" ? "icon" : "default";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={buttonSize}
          className={cn(
            "relative rounded-full border border-border/60 bg-card/70 text-foreground shadow-xs transition-all duration-200 hover:border-border hover:bg-accent/60",
            buttonSize === "icon" && "size-9",
            isTransitioning && "cursor-wait opacity-50",
            className
          )}
          aria-label="Select language"
          disabled={isTransitioning}
        >
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]" sideOffset={8}>
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleLocaleChange(locale)}
            className="flex cursor-pointer items-center justify-between"
          >
            <span>{localeLabels[locale]}</span>
            {locale === currentLocale && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
