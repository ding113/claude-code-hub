import type React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "加载中", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("text-xs text-muted-foreground", className)}
    >
      {label}
    </div>
  );
}

interface PageHeaderSkeletonProps {
  titleWidth?: string;
  descriptionWidth?: string;
  showDescription?: boolean;
  className?: string;
}

export function PageHeaderSkeleton({
  titleWidth = "w-48",
  descriptionWidth = "w-72",
  showDescription = true,
  className,
}: PageHeaderSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className={cn("h-7", titleWidth)} />
      {showDescription ? <Skeleton className={cn("h-4", descriptionWidth)} /> : null}
    </div>
  );
}

interface SectionSkeletonProps {
  titleWidth?: string;
  descriptionWidth?: string;
  showDescription?: boolean;
  showActions?: boolean;
  rows?: number;
  className?: string;
  body?: React.ReactNode;
}

export function SectionSkeleton({
  titleWidth = "w-32",
  descriptionWidth = "w-56",
  showDescription = true,
  showActions = false,
  rows = 3,
  className,
  body,
}: SectionSkeletonProps) {
  return (
    <section
      className={cn(
        "bg-card text-card-foreground border border-border rounded-xl shadow-sm p-5 space-y-4",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className={cn("h-5", titleWidth)} />
          {showDescription ? <Skeleton className={cn("h-4", descriptionWidth)} /> : null}
        </div>
        {showActions ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : null}
      </div>
      {body ? (
        body
      ) : (
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, index) => (
            <Skeleton key={`section-row-${index}`} className="h-5 w-full" />
          ))}
        </div>
      )}
    </section>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  rowHeightClassName?: string;
}

export function TableSkeleton({
  rows = 6,
  columns = 4,
  rowHeightClassName = "h-5",
}: TableSkeletonProps) {
  const columnTemplate = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div className="space-y-3">
      <div className="grid gap-4" style={columnTemplate}>
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={`table-head-${index}`} className="h-4 w-full" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={`table-row-${rowIndex}`} className="grid gap-4" style={columnTemplate}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton
                key={`table-cell-${rowIndex}-${colIndex}`}
                className={cn(rowHeightClassName, "w-full")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface CardGridSkeletonProps {
  cards?: number;
  className?: string;
}

export function CardGridSkeleton({ cards = 4, className }: CardGridSkeletonProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      {Array.from({ length: cards }).map((_, index) => (
        <div key={`card-skeleton-${index}`} className="rounded-lg border bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

interface ListSkeletonProps {
  rows?: number;
  className?: string;
}

export function ListSkeleton({ rows = 5, className }: ListSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={`list-row-${index}`} className="h-5 w-full" />
      ))}
    </div>
  );
}
