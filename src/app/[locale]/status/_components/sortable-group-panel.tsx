"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface SortableGroupPanelProps {
  slug: string;
  displayName: string;
  modelCount: number;
  issueCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draggable: boolean;
  children: ReactNode;
  issueBadgeLabel?: string;
  modelBadgeLabel?: string;
}

export function SortableGroupPanel({
  slug,
  displayName,
  modelCount,
  issueCount,
  open,
  onOpenChange,
  draggable,
  children,
  issueBadgeLabel,
  modelBadgeLabel,
}: SortableGroupPanelProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slug,
    disabled: !draggable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-2xl border border-border/60 bg-card/40 p-4 shadow-sm backdrop-blur-sm sm:p-6",
        isDragging && "ring-2 ring-primary"
      )}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center gap-2">
          {draggable ? (
            <button
              type="button"
              className="cursor-grab rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
              aria-label="drag"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          ) : null}
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left transition-colors hover:bg-accent/40">
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open ? "rotate-0" : "-rotate-90"
              )}
            />
            <h2 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {displayName}
            </h2>
            <span className="ml-auto flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {modelBadgeLabel ? (
                <span className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5">
                  {modelCount} {modelBadgeLabel}
                </span>
              ) : null}
              {issueCount > 0 && issueBadgeLabel ? (
                <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-rose-600 dark:text-rose-400">
                  {issueCount} {issueBadgeLabel}
                </span>
              ) : null}
            </span>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
