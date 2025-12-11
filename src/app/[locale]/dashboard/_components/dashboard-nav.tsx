"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;

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

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) {
        clearTimeout(openTimeoutRef.current);
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

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
    // Clear any existing timeouts
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
    }
    // Delay opening to prevent accidental triggers when moving mouse quickly
    openTimeoutRef.current = setTimeout(() => {
      setSettingsOpen(true);
    }, OPEN_DELAY_MS);
  };

  const handleMouseLeave = () => {
    // Clear open timeout
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    // Delay closing to give user time to move to the menu
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      setSettingsOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const renderSettingsDropdown = (item: DashboardNavItem, isActive: boolean) => {
    // Disable dropdown menu completely when on a settings page
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
      <div onPointerEnter={handleMouseEnter} onPointerLeave={handleMouseLeave}>
        <DropdownMenu modal={false} open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DropdownMenuTrigger asChild>
            <Link
              href="/settings/config"
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-all",
                "text-muted-foreground hover:text-foreground",
                isActive && "bg-primary/5 text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
              )}
            >
              {item.label}
              <ChevronDown className="size-3 opacity-50" />
            </Link>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            className="w-56"
            sideOffset={4}
            onPointerEnter={handleMouseEnter}
            onPointerLeave={handleMouseLeave}
          >
            {SETTINGS_NAV_ITEMS.map((subItem, index) => {
              const showSeparator = subItem.external && !SETTINGS_NAV_ITEMS[index - 1]?.external;

              return (
                <div key={subItem.href}>
                  {showSeparator && <DropdownMenuSeparator />}
                  <DropdownMenuItem asChild>
                    {subItem.external ? (
                      <a
                        href={subItem.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex cursor-pointer items-center justify-between"
                      >
                        <span>{t(subItem.labelKey || "")}</span>
                        <ExternalLink className="size-3 opacity-50" />
                      </a>
                    ) : (
                      <Link
                        href={subItem.href}
                        className="flex cursor-pointer items-center justify-between"
                      >
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
    <nav className="hidden items-center gap-1 overflow-x-auto rounded-full border border-border/80 bg-background/80 px-1 py-1 backdrop-blur scrollbar-hide supports-[backdrop-filter]:bg-background/60 md:flex">
      {items.map((item) => {
        const isActive = getIsActive(item.href);

        if (item.href === "/settings") {
          return <div key={item.href}>{renderSettingsDropdown(item, isActive)}</div>;
        }

        const className = cn(
          "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
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
