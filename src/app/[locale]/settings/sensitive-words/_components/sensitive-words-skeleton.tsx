import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function SensitiveWordsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <TableSkeleton rows={6} columns={3} />
        <LoadingState />
      </div>
    </div>
  );
}

export function SensitiveWordsTableSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" aria-busy="true">
      <TableSkeleton rows={6} columns={3} />
      <LoadingState />
    </div>
  );
}
