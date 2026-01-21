"use client";

import { motion } from "framer-motion";
import { FileText, FlaskConical, Gauge, Network, Route } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TabId } from "../provider-form-types";

const TAB_CONFIG: { id: TabId; icon: typeof FileText; labelKey: string }[] = [
  { id: "basic", icon: FileText, labelKey: "tabs.basic" },
  { id: "routing", icon: Route, labelKey: "tabs.routing" },
  { id: "limits", icon: Gauge, labelKey: "tabs.limits" },
  { id: "network", icon: Network, labelKey: "tabs.network" },
  { id: "testing", icon: FlaskConical, labelKey: "tabs.testing" },
];

interface FormTabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  disabled?: boolean;
  tabStatus?: Partial<Record<TabId, "default" | "warning" | "configured">>;
}

export function FormTabNav({ activeTab, onTabChange, disabled, tabStatus = {} }: FormTabNavProps) {
  const t = useTranslations("settings.providers.form");

  const getStatusColor = (status?: "default" | "warning" | "configured") => {
    switch (status) {
      case "warning":
        return "bg-yellow-500";
      case "configured":
        return "bg-primary";
      default:
        return null;
    }
  };

  return (
    <>
      {/* Desktop: Vertical Sidebar */}
      <nav className="hidden lg:flex flex-col w-[200px] shrink-0 border-r border-border/50 bg-card/30">
        <div className="p-4 space-y-1">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const status = tabStatus[tab.id];
            const statusColor = getStatusColor(status);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                disabled={disabled}
                className={cn(
                  "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                  "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
                    isActive ? "bg-primary/20" : "bg-muted/50"
                  )}
                >
                  <Icon
                    className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                </span>
                <span className="flex-1 text-left">{t(tab.labelKey)}</span>
                {statusColor && (
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      statusColor,
                      status === "warning" && "animate-pulse"
                    )}
                  />
                )}
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-l-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Tablet: Horizontal Tabs */}
      <nav className="hidden md:flex lg:hidden sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-md">
        <div className="flex items-center gap-1 px-4 overflow-x-auto scrollbar-hide">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const status = tabStatus[tab.id];
            const statusColor = getStatusColor(status);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                disabled={disabled}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all whitespace-nowrap",
                  "hover:text-foreground focus-visible:outline-none",
                  isActive ? "text-primary" : "text-muted-foreground",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-7 h-7 rounded-md transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>{t(tab.labelKey)}</span>
                {statusColor && (
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      statusColor,
                      status === "warning" && "animate-pulse"
                    )}
                  />
                )}
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicatorTablet"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile: Bottom Navigation */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-card/95 backdrop-blur-md safe-area-bottom">
        <div className="flex items-center justify-around w-full px-2 py-1">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const status = tabStatus[tab.id];
            const statusColor = getStatusColor(status);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                disabled={disabled}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-all",
                  "hover:bg-accent/50 focus-visible:outline-none active:scale-95",
                  isActive ? "text-primary" : "text-muted-foreground",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <span className="relative">
                  <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  {statusColor && (
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-card",
                        statusColor,
                        status === "warning" && "animate-pulse"
                      )}
                    />
                  )}
                </span>
                <span className="text-[10px] font-medium">{t(tab.labelKey)}</span>
                {/* Progress indicator */}
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {isActive && (
                    <motion.div
                      layoutId="activeTabIndicatorMobile"
                      className="w-4 h-1 bg-primary rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {/* Step indicator */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: "20%" }}
            animate={{
              width: `${((TAB_CONFIG.findIndex((t) => t.id === activeTab) + 1) / TAB_CONFIG.length) * 100}%`,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
      </nav>
    </>
  );
}

export { TAB_CONFIG };
