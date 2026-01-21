import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function SensitiveWordsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/50 backdrop-blur-sm p-5 space-y-3">
        <Skeleton className="h-5 w-40 bg-white/10" />
        <Skeleton className="h-4 w-56 bg-white/5" />
      </div>
      <div className="rounded-xl border border-border bg-muted/50 backdrop-blur-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36 bg-white/10" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 bg-white/10" />
            <Skeleton className="h-9 w-24 bg-white/10" />
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
    <div
      className="rounded-lg border border-border bg-muted/50 backdrop-blur-sm space-y-4"
      aria-busy="true"
    >
      <TableSkeleton rows={6} columns={3} />
      <LoadingState />
    </div>
  );
}
