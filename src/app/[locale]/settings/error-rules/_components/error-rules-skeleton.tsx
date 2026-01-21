import { Skeleton } from "@/components/ui/skeleton";

export function ErrorRulesSkeleton() {
  return (
    <div className="space-y-6">
      {/* Tester Section Skeleton */}
      <div className="rounded-xl border border-white/5 bg-card/30 backdrop-blur-sm p-5 md:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>

      {/* Rules List Section Skeleton */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 backdrop-blur-sm p-5 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
        <ErrorRulesTableSkeleton />
      </div>
    </div>
  );
}

export function ErrorRulesTableSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3 flex-1">
            <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-10 rounded-full" />
            <div className="flex gap-1">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
