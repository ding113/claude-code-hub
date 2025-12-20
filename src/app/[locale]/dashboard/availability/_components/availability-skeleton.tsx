import { ListSkeleton, LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function AvailabilityViewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <ListSkeleton rows={6} />
      </div>
      <LoadingState />
    </div>
  );
}
