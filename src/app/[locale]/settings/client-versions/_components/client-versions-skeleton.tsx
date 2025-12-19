import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ClientVersionsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <Skeleton className="h-5 w-40" />
        <TableSkeleton rows={6} columns={4} />
        <LoadingState />
      </div>
    </div>
  );
}

export function ClientVersionsSettingsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-10 w-32" />
      <LoadingState />
    </div>
  );
}

export function ClientVersionsTableSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <TableSkeleton rows={6} columns={4} />
      <LoadingState />
    </div>
  );
}
