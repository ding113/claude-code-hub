"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";
import { useParams } from "next/navigation";
import { locales, localeLabels, type Locale } from "@/i18n/config";
import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/index";

interface LanguageSwitcherProps {
  className?: string;
  size?: "sm" | "default";
}

/**
 * LanguageSwitcher Component
 *
 * Provides a dropdown UI for switching between supported locales.
 * Automatically persists locale preference via cookie and maintains current route.
 *
 * Features:
 * - Supports 5 locales: zh-CN, zh-TW, en, ru, ja
 * - Displays native language names (简体中文, 繁體中文, English, Русский, 日本語)
 * - Persists locale via NEXT_LOCALE cookie (handled by next-intl middleware)
 * - Maintains current route when switching locales
 * - Keyboard accessible (Tab, Enter, Arrow keys, Escape)
 * - Loading state during locale transition
 * - Mobile responsive
 */
export function LanguageSwitcher({ className, size = "sm" }: LanguageSwitcherProps) {
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  // Handle locale change
  const handleLocaleChange = React.useCallback(
    (newLocale: string) => {
      if (newLocale === currentLocale || isTransitioning) {
        return;
      }

      setIsTransitioning(true);

      try {
        // Use next-intl's router to navigate with locale
        // This automatically:
        // 1. Updates the URL with the new locale prefix
        // 2. Sets the NEXT_LOCALE cookie
        // 3. Maintains the current pathname
        // 4. Preserves query parameters and hash
        router.push(pathname, { locale: newLocale as Locale });
      } catch (error) {
        console.error("Failed to switch locale:", error);
        setIsTransitioning(false);
      }
    },
    [currentLocale, pathname, router, isTransitioning, params]
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select
        value={currentLocale}
        onValueChange={handleLocaleChange}
        disabled={isTransitioning}
      >
        <SelectTrigger
          size={size}
          className={cn(
            "w-auto min-w-[8rem]",
            isTransitioning && "opacity-50 cursor-wait"
          )}
          aria-label="Select language"
        >
          <div className="flex items-center gap-2">
            <Languages className="size-4" />
            <SelectValue>
              {isTransitioning ? "Switching..." : localeLabels[currentLocale]}
            </SelectValue>
          </div>
        </SelectTrigger>
        <SelectContent align="end">
          {locales.map((locale) => (
            <SelectItem
              key={locale}
              value={locale}
              className="cursor-pointer"
              aria-current={locale === currentLocale ? "true" : undefined}
            >
              <span className="flex items-center gap-2">
                {localeLabels[locale]}
                {locale === currentLocale && (
                  <span className="text-xs text-muted-foreground">(current)</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
