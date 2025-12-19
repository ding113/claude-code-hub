import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ProvidersQuotaSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <TableSkeleton rows={6} columns={6} />
        <LoadingState />
      </div>
    </div>
  );
}
