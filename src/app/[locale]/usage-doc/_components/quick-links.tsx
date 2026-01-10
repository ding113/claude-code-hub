"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

interface QuickLinksProps {
  isLoggedIn: boolean;
  onBackToTop?: () => void;
}

/**
 * 快速链接组件
 * 支持桌面端和移动端复用
 */
export function QuickLinks({ isLoggedIn, onBackToTop }: QuickLinksProps) {
  const t = useTranslations("usage");

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    onBackToTop?.();
  };

  return (
    <div className="space-y-2">
      {isLoggedIn && (
        <Link
          href="/dashboard"
          className="block text-sm text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1"
        >
          {t("navigation.backToDashboard")}
        </Link>
      )}
      <button
        onClick={handleBackToTop}
        className="block w-full text-left text-sm text-muted-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1 cursor-pointer"
      >
        {t("navigation.backToTop")}
      </button>
    </div>
  );
}
