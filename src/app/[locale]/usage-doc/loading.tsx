import { ListSkeleton, LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function UsageDocLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <ListSkeleton rows={6} />
        </aside>
        <div className="space-y-4">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <LoadingState />
        </div>
      </div>
    </div>
  );
}
