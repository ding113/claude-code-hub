import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function SessionMessagesLoading() {
  return (
    <div className="flex h-full">
      <aside className="w-72 border-r bg-card p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <TableSkeleton rows={6} columns={1} />
      </aside>
      <div className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-28" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <LoadingState />
      </div>
    </div>
  );
}
