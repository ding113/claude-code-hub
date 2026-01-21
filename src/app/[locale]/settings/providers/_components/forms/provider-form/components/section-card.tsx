"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  badge?: ReactNode;
  variant?: "default" | "highlight" | "warning";
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  className,
  badge,
  variant = "default",
}: SectionCardProps) {
  const variantStyles = {
    default: "border-border/50 hover:border-border",
    highlight: "border-primary/30 hover:border-primary/50",
    warning: "border-yellow-500/30 hover:border-yellow-500/50",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card/30 backdrop-blur-sm",
        "transition-all duration-200",
        variantStyles[variant],
        className
      )}
    >
      {/* Glassmorphism gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

      {/* Glow effect for highlight variant */}
      {variant === "highlight" && (
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      )}

      <div className="relative z-10">
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="flex items-start gap-3">
              {Icon && (
                <span
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
                    variant === "highlight"
                      ? "bg-primary/10 text-primary"
                      : variant === "warning"
                        ? "bg-yellow-500/10 text-yellow-500"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
              )}
              <div className="space-y-1">
                {title && (
                  <h3 className="text-sm font-semibold text-foreground leading-none">{title}</h3>
                )}
                {description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                )}
              </div>
            </div>
            {badge}
          </div>
        )}
        <div className={cn("px-5 pb-5", !title && !description && "pt-5")}>{children}</div>
      </div>
    </motion.div>
  );
}

// Field group for visual grouping within a section
interface FieldGroupProps {
  label?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  horizontal?: boolean;
}

export function FieldGroup({
  label,
  description,
  children,
  className,
  horizontal = false,
}: FieldGroupProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {(label || description) && (
        <div className="space-y-1">
          {label && <div className="text-sm font-medium text-foreground">{label}</div>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className={cn(horizontal ? "grid gap-4 sm:grid-cols-2" : "space-y-4")}>{children}</div>
    </div>
  );
}

// Smart input wrapper with inline validation
interface SmartInputWrapperProps {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  tooltip?: string;
  children: ReactNode;
  className?: string;
}

export function SmartInputWrapper({
  label,
  description,
  error,
  required,
  children,
  className,
}: SmartInputWrapperProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

// Toggle row for switch controls
interface ToggleRowProps {
  label: string;
  description?: string;
  children: ReactNode; // Switch component
  icon?: LucideIcon;
  iconColor?: string;
  className?: string;
}

export function ToggleRow({
  label,
  description,
  children,
  icon: Icon,
  iconColor = "text-muted-foreground",
  className,
}: ToggleRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 p-4 rounded-xl",
        "bg-muted/30 border border-border/50 hover:border-border transition-colors",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <span
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0 mt-0.5",
              iconColor
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="space-y-0.5">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
