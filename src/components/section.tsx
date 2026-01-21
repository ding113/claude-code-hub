"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Database,
  DollarSign,
  Download,
  FileText,
  Filter,
  FlaskConical,
  HardDrive,
  Link2,
  type LucideIcon,
  Power,
  Settings,
  ShieldAlert,
  Smartphone,
  Trash2,
  TrendingUp,
  Upload,
  Webhook,
} from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

// Icon name type for serialization across server/client boundary
export type SectionIconName =
  | "settings"
  | "trash"
  | "database"
  | "hard-drive"
  | "download"
  | "upload"
  | "file-text"
  | "bell"
  | "webhook"
  | "shield-alert"
  | "alert-triangle"
  | "filter"
  | "smartphone"
  | "dollar-sign"
  | "link"
  | "power"
  | "trending-up"
  | "flask-conical";

// Map icon names to components (client-side only)
const SECTION_ICON_MAP: Record<SectionIconName, LucideIcon> = {
  settings: Settings,
  trash: Trash2,
  database: Database,
  "hard-drive": HardDrive,
  download: Download,
  upload: Upload,
  "file-text": FileText,
  bell: Bell,
  webhook: Webhook,
  "shield-alert": ShieldAlert,
  "alert-triangle": AlertTriangle,
  filter: Filter,
  smartphone: Smartphone,
  "dollar-sign": DollarSign,
  link: Link2,
  power: Power,
  "trending-up": TrendingUp,
  "flask-conical": FlaskConical,
};

export type SectionProps = {
  title: string;
  description?: string;
  icon?: SectionIconName;
  iconColor?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "highlight" | "warning";
  noPadding?: boolean;
};

export function Section({
  title,
  description,
  icon,
  iconColor = "text-primary",
  actions,
  children,
  className,
  variant = "default",
  noPadding,
}: SectionProps) {
  const variantStyles = {
    default: "bg-card/50 border-border/50 hover:border-border/80",
    highlight: "bg-primary/5 border-primary/20 hover:border-primary/30",
    warning: "bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/30",
  };

  const Icon = icon ? SECTION_ICON_MAP[icon] : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "relative overflow-hidden rounded-xl border backdrop-blur-sm transition-colors duration-200",
        variantStyles[variant],
        !noPadding && "p-5 md:p-6",
        className
      )}
    >
      {/* Decorative gradient blob for highlight variant */}
      {variant === "highlight" && (
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none -translate-y-1/2 translate-x-1/2" />
      )}

      <div className="relative z-10">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-lg shrink-0 mt-0.5",
                  variant === "highlight" ? "bg-primary/20" : "bg-muted/50"
                )}
              >
                <Icon className={cn("h-4 w-4", iconColor)} />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
              {description && (
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>
    </motion.section>
  );
}

// Legacy support - simple section without animation
export function SectionStatic({
  title,
  description,
  actions,
  children,
  className,
}: Omit<SectionProps, "icon" | "iconColor" | "variant" | "noPadding">) {
  return (
    <section
      className={cn(
        "bg-card/50 border border-border/50 hover:border-border/80 rounded-xl p-5 md:p-6 transition-colors duration-200",
        className
      )}
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
