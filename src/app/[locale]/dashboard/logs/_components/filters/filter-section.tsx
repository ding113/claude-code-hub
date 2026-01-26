"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface FilterSectionProps {
  title: string;
  description?: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
  activeCount?: number;
  className?: string;
}

export function FilterSection({
  title,
  description,
  icon: Icon,
  defaultOpen = false,
  children,
  activeCount = 0,
  className,
}: FilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          // Glass morphism base
          "relative overflow-hidden rounded-xl border bg-card/30 backdrop-blur-sm",
          "transition-all duration-200",
          "border-border/50 hover:border-border",
          className
        )}
      >
        {/* Glassmorphism gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

        <div className="relative z-10">
          {/* Header - always visible */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-3",
                "text-left transition-colors cursor-pointer",
                "active:bg-muted/30"
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
                    "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-foreground leading-none">{title}</h3>
                  {description && (
                    <p className="text-xs text-muted-foreground leading-relaxed hidden sm:block">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeCount > 0 && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    {activeCount}
                  </Badge>
                )}
                {/* Chevron visible on all screen sizes */}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180"
                  )}
                />
              </div>
            </button>
          </CollapsibleTrigger>

          {/* Content - collapsible on all screen sizes */}
          <CollapsibleContent className="px-4 pb-4">
            <div className="pt-1">{children}</div>
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  );
}
