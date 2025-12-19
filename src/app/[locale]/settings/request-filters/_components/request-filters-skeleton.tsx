import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function RequestFiltersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <TableSkeleton rows={6} columns={4} />
        <LoadingState />
      </div>
    </div>
  );
}

export function RequestFiltersTableSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" aria-busy="true">
      <TableSkeleton rows={6} columns={4} />
      <LoadingState />
    </div>
  );
}
