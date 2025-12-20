"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatMessage } from "./utils";

export interface FieldCardProps {
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  enableFieldAria: string;
  children: ReactNode;
}

/**
 * A card component for batch edit fields with an enable/disable switch
 */
export function FieldCard({
  title,
  enabled,
  onEnabledChange,
  enableFieldAria,
  children,
}: FieldCardProps) {
  return (
    <div className={cn("rounded-md border p-3 space-y-3", !enabled && "opacity-80")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={formatMessage(enableFieldAria, { title })}
        />
      </div>
      {children}
    </div>
  );
}
