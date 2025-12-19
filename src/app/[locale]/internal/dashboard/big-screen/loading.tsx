import { LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function BigScreenLoading() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`big-screen-card-${index}`} className="h-28 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <LoadingState className="text-center" />
    </div>
  );
}
