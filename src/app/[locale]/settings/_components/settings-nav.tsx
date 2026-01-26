"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Database,
  DollarSign,
  ExternalLink,
  FileText,
  Filter,
  HelpCircle,
  type LucideIcon,
  MessageCircle,
  Server,
  Settings,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { SettingsNavIconName, SettingsNavItem } from "../_lib/nav-items";

// Map icon names to actual icon components (client-side only)
const ICON_MAP: Record<SettingsNavIconName, LucideIcon> = {
  settings: Settings,
  "dollar-sign": DollarSign,
  server: Server,
  "shield-alert": ShieldAlert,
  "alert-triangle": AlertTriangle,
  filter: Filter,
  smartphone: Smartphone,
  database: Database,
  "file-text": FileText,
  bell: Bell,
  "book-open": BookOpen,
  "help-circle": HelpCircle,
  "message-circle": MessageCircle,
  "external-link": ExternalLink,
};

interface SettingsNavProps {
  items: SettingsNavItem[];
}

export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname();
  const t = useTranslations("common");

  if (items.length === 0) {
    return null;
  }

  // Split internal and external items
  const internalItems = items.filter((item) => !item.external);
  const externalItems = items.filter((item) => item.external);

  const getIsActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const getIcon = (iconName?: SettingsNavIconName): LucideIcon => {
    if (!iconName) return Settings;
    return ICON_MAP[iconName] || Settings;
  };

  return (
    <>
      {/* Desktop: Vertical Sidebar */}
      <nav className="hidden lg:flex flex-col w-full shrink-0 rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="p-3 space-y-1">
          {internalItems.map((item) => {
            const Icon = getIcon(item.iconName);
            const isActive = getIsActive(item.href);

            return (
              <motion.div
                key={item.href}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200",
                    "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <motion.span
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg",
                      isActive ? "bg-primary/20" : "bg-muted/50"
                    )}
                    animate={{
                      backgroundColor: isActive
                        ? "hsl(var(--primary) / 0.2)"
                        : "hsl(var(--muted) / 0.5)",
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <Icon
                      className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")}
                    />
                  </motion.span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="settingsActiveTabIndicator"
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-l-full"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* External Links Section */}
        {externalItems.length > 0 && (
          <div className="border-t border-border/50 p-3 space-y-1">
            {externalItems.map((item) => {
              const Icon = getIcon(item.iconName);
              return (
                <motion.a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200",
                    "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </motion.a>
              );
            })}
          </div>
        )}

        {/* Theme Switcher */}
        <div className="border-t border-border/50 p-3">
          <div className="rounded-lg border border-dashed border-border/80 bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("appearance")}
                </p>
                <p className="text-sm text-foreground/90">{t("theme")}</p>
              </div>
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </nav>

      {/* Tablet: Horizontal Tabs */}
      <nav className="hidden md:flex lg:hidden sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-md rounded-xl mb-4">
        <div className="flex items-center gap-1 px-2 overflow-x-auto scrollbar-hide">
          {internalItems.map((item) => {
            const Icon = getIcon(item.iconName);
            const isActive = getIsActive(item.href);

            return (
              <motion.div
                key={item.href}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2 px-3 py-3 text-sm font-medium transition-colors duration-200 whitespace-nowrap",
                    "hover:text-foreground focus-visible:outline-none",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <motion.span
                    className={cn(
                      "flex items-center justify-center w-7 h-7 rounded-md",
                      isActive ? "bg-primary/10" : "hover:bg-muted/50"
                    )}
                    animate={{
                      backgroundColor: isActive ? "hsl(var(--primary) / 0.1)" : "transparent",
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <Icon className="h-4 w-4" />
                  </motion.span>
                  <span>{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="settingsActiveTabIndicatorTablet"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </nav>

      {/* Mobile: Bottom Navigation */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-card/95 backdrop-blur-md safe-area-bottom">
        <div className="flex items-center justify-around w-full px-2 py-1">
          {internalItems.slice(0, 5).map((item) => {
            const Icon = getIcon(item.iconName);
            const isActive = getIsActive(item.href);

            return (
              <motion.div
                key={item.href}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors duration-200",
                    "hover:bg-accent/50 focus-visible:outline-none",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <motion.div
                    animate={{ scale: isActive ? 1.1 : 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  </motion.div>
                  <span className="text-[10px] font-medium truncate max-w-[48px]">
                    {item.label}
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="settingsActiveTabIndicatorMobile"
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-primary rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
        {/* Progress indicator */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: "10%" }}
            animate={{
              width: `${((internalItems.findIndex((item) => getIsActive(item.href)) + 1) / internalItems.length) * 100}%`,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
      </nav>
    </>
  );
}
