import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ClientVersionsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Settings Section Skeleton */}
      <div className="rounded-xl border border-white/5 bg-card/30 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg bg-white/5" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-40 bg-white/5" />
            <Skeleton className="h-4 w-64 bg-white/5" />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <Skeleton className="h-12 w-full bg-white/5" />
        </div>
      </div>
      {/* Stats Section Skeleton */}
      <div className="rounded-xl border border-white/5 bg-card/30 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-9 w-9 rounded-lg bg-white/5" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48 bg-white/5" />
            <Skeleton className="h-4 w-72 bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <Skeleton className="h-4 w-20 bg-white/5 mb-2" />
              <Skeleton className="h-6 w-12 bg-white/5" />
            </div>
          ))}
        </div>
        <TableSkeleton rows={4} columns={4} />
      </div>
    </div>
  );
}

export function ClientVersionsSettingsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
        <div className="flex items-start gap-3">
          <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 bg-white/5" />
            <Skeleton className="h-3 w-48 bg-white/5" />
          </div>
        </div>
        <Skeleton className="h-6 w-10 rounded-full bg-white/5" />
      </div>
      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="flex items-start gap-3">
          <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-24 bg-white/5" />
            <Skeleton className="h-3 w-full bg-white/5" />
            <Skeleton className="h-3 w-3/4 bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientVersionsTableSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-4 w-4 rounded bg-white/5" />
              <Skeleton className="h-3 w-16 bg-white/5" />
            </div>
            <Skeleton className="h-6 w-10 bg-white/5" />
          </div>
        ))}
      </div>
      {/* Table Skeleton */}
      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 bg-white/5" />
              <Skeleton className="h-3 w-56 bg-white/5" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full bg-white/5" />
        </div>
        <div className="rounded-xl border border-white/5 overflow-hidden bg-black/10">
          <TableSkeleton rows={4} columns={4} />
        </div>
      </div>
      <LoadingState />
    </div>
  );
}
