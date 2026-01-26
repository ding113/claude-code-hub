import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AvailabilityDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Overview Section - 4 Gauge Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-2xl p-4 md:p-6",
              "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
              "backdrop-blur-lg",
              "border border-border/50 dark:border-white/[0.08]"
            )}
          >
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-24 w-24 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <Skeleton className="h-10 w-40 rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>

      {/* Main Content Area */}
      <div className="space-y-6">
        {/* Time Range Selector */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-16 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>

        {/* Lane Chart Area */}
        <div
          className={cn(
            "rounded-2xl p-4 md:p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]"
          )}
        >
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-8 w-32 shrink-0" />
                <Skeleton className="h-8 flex-1" />
                <Skeleton className="h-8 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Latency Chart Area */}
        <div
          className={cn(
            "rounded-2xl p-4 md:p-6",
            "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
            "backdrop-blur-lg",
            "border border-border/50 dark:border-white/[0.08]"
          )}
        >
          <Skeleton className="h-5 w-40 mb-4" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// Keep the old skeleton for backward compatibility if needed elsewhere
export function AvailabilityViewSkeleton() {
  return <AvailabilityDashboardSkeleton />;
}
