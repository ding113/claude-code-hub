import { CardGridSkeleton, ListSkeleton, LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardOverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-3 space-y-3">
        <CardGridSkeleton cards={4} className="grid-cols-2" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="lg:col-span-9">
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="p-4">
            <ListSkeleton rows={6} />
          </div>
        </div>
      </div>
      <LoadingState />
    </div>
  );
}

export function DashboardStatisticsSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-64 w-full" />
      <LoadingState />
    </div>
  );
}

export function DashboardLeaderboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <ListSkeleton rows={5} />
        <LoadingState />
      </div>
    </div>
  );
}
