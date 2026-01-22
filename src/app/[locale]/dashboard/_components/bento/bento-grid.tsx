"use client";

import { forwardRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BentoGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * Bento Grid Container
 * Responsive grid layout with asymmetric card sizes
 */
export function BentoGrid({ children, className }: BentoGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4 md:gap-6",
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        "auto-rows-[minmax(140px,auto)]",
        className
      )}
    >
      {children}
    </div>
  );
}

interface BentoCardProps {
  children: ReactNode;
  className?: string;
  colSpan?: 1 | 2 | 3 | 4;
  rowSpan?: 1 | 2 | 3;
  interactive?: boolean;
  onClick?: () => void;
}

const colSpanClasses = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 lg:col-span-3",
  4: "sm:col-span-2 lg:col-span-4",
};

const rowSpanClasses = {
  1: "",
  2: "row-span-2",
  3: "row-span-3",
};

/**
 * Bento Card Component
 * Individual card within the Bento Grid with glassmorphism styling
 */
export const BentoCard = forwardRef<HTMLDivElement, BentoCardProps>(
  ({ children, className, colSpan = 1, rowSpan = 1, interactive = false, onClick }, ref) => {
    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (interactive && onClick && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onClick();
      }
    };

    return (
      <div
        ref={ref}
        onClick={onClick}
        onKeyDown={interactive ? handleKeyDown : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        className={cn(
          // Base styles - Glass morphism (subtle)
          "relative overflow-hidden rounded-2xl",
          "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
          "backdrop-blur-lg",
          "border border-border/50 dark:border-white/[0.08]",
          "shadow-sm",
          "p-4 md:p-5",
          // Inner light gradient
          "before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent before:pointer-events-none before:z-[1]",
          // Transitions
          "transition-all duration-300 ease-out",
          // Hover effects for interactive cards
          interactive && [
            "cursor-pointer",
            "hover:border-primary/20 hover:shadow-md",
            "hover:-translate-y-0.5",
            "active:scale-[0.99]",
          ],
          // Group for child hover effects
          "group",
          // Span classes
          colSpanClasses[colSpan],
          rowSpanClasses[rowSpan],
          className
        )}
      >
        {/* Content wrapper to ensure z-index above pseudo-element */}
        <div className="relative z-10 h-full">{children}</div>
      </div>
    );
  }
);

BentoCard.displayName = "BentoCard";
