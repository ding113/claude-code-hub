"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { SETTINGS_NAV_ITEMS } from "@/app/[locale]/settings/_lib/nav-items";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export interface DashboardNavItem {
  href: string;
  label: string;
  external?: boolean;
  type?: "dropdown";
}

interface DashboardNavProps {
  items: DashboardNavItem[];
}

export function DashboardNav({ items }: DashboardNavProps) {
  const pathname = usePathname();
  const t = useTranslations("settings");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  if (items.length === 0) {
    return null;
  }

  const getIsActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }

    return pathname.startsWith(href);
  };

  const handleMouseEnter = () => {
    // 清除所有延时
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
    }
    // 延迟150ms打开，避免鼠标快速划过时误触发
    openTimeoutRef.current = setTimeout(() => {
      setSettingsOpen(true);
    }, 150);
  };

  const handleMouseLeave = () => {
    // 清除打开延时
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    // 延迟200ms关闭，给用户足够时间移动到菜单
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      setSettingsOpen(false);
    }, 200);
  };

  const renderSettingsDropdown = (item: DashboardNavItem, isActive: boolean) => {
    // 在设置页面时完全禁用下拉菜单
    if (isActive) {
      return (
        <div
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all",
            "bg-primary/5 text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
          )}
        >
          {item.label}
        </div>
      );
    }

    return (
      <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <DropdownMenu modal={false} open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DropdownMenuTrigger asChild>
            <Link
              href="/settings/config"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-all",
                "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
              <ChevronDown className="size-3 opacity-50" />
            </Link>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-56" sideOffset={4}>
            {SETTINGS_NAV_ITEMS.map((subItem, index) => {
              const showSeparator = index === 10;

              return (
                <div key={subItem.href}>
                  {showSeparator && <DropdownMenuSeparator />}
                  <DropdownMenuItem asChild>
                    {subItem.external ? (
                      <a
                        href={subItem.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between"
                      >
                        <span>{t(subItem.labelKey || "")}</span>
                        <ExternalLink className="size-3 opacity-50" />
                      </a>
                    ) : (
                      <Link href={subItem.href} className="flex items-center justify-between">
                        {t(subItem.labelKey || "")}
                      </Link>
                    )}
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <nav className="flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {items.map((item) => {
        const isActive = getIsActive(item.href);

        if (item.href === "/settings") {
          return <div key={item.href}>{renderSettingsDropdown(item, isActive)}</div>;
        }

        const className = cn(
          "rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
          isActive && "bg-primary/5 text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
        );

        if (item.external) {
          return (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {item.label}
            </a>
          );
        }

        return (
          <Link key={item.href} href={item.href} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
