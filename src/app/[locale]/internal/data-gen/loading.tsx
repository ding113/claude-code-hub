import { LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function DataGenLoading() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-48 w-full" />
      <LoadingState className="text-center" />
    </div>
  );
}
