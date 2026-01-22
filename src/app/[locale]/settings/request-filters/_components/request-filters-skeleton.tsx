import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function RequestFiltersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/5 bg-card/30 backdrop-blur-sm p-5 space-y-3">
        <Skeleton className="h-5 w-40 bg-white/5" />
        <Skeleton className="h-4 w-56 bg-white/5" />
      </div>
      <div className="rounded-xl border border-white/5 bg-card/30 backdrop-blur-sm p-5 space-y-4">
        <TableSkeleton rows={6} columns={4} />
        <LoadingState />
      </div>
    </div>
  );
}

export function RequestFiltersTableSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex justify-between gap-3 mb-4">
        <Skeleton className="h-9 w-32 bg-white/5" />
        <Skeleton className="h-9 w-24 bg-white/5" />
      </div>
      <div className="rounded-xl border border-white/5 overflow-hidden">
        <div className="bg-white/[0.02] px-4 py-3 border-b border-white/5">
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24 bg-white/5" />
            <Skeleton className="h-4 w-16 bg-white/5" />
            <Skeleton className="h-4 w-20 bg-white/5" />
            <Skeleton className="h-4 w-32 bg-white/5" />
            <Skeleton className="h-4 w-24 bg-white/5" />
          </div>
        </div>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="px-4 py-3 border-b border-white/5 last:border-b-0 flex items-center gap-4"
          >
            <Skeleton className="h-4 w-32 bg-white/5" />
            <Skeleton className="h-5 w-16 bg-white/5 rounded-full" />
            <Skeleton className="h-5 w-20 bg-white/5 rounded-full" />
            <Skeleton className="h-6 w-40 bg-white/5 rounded-lg" />
            <Skeleton className="h-4 w-24 bg-white/5" />
            <Skeleton className="h-4 w-8 bg-white/5" />
            <Skeleton className="h-4 w-8 bg-white/5" />
            <Skeleton className="h-5 w-10 bg-white/5 rounded-full" />
            <div className="flex gap-1 ml-auto">
              <Skeleton className="h-8 w-8 bg-white/5 rounded" />
              <Skeleton className="h-8 w-8 bg-white/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
