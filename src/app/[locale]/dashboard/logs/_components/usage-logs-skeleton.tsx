import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function UsageLogsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <Skeleton className="h-6 w-32" />
        <TableSkeleton rows={8} columns={6} />
        <LoadingState />
      </div>
    </div>
  );
}
