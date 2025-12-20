import { ListSkeleton, LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function ActiveSessionsSkeleton() {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="p-4 space-y-3">
        <ListSkeleton rows={5} />
        <LoadingState />
      </div>
    </div>
  );
}
