import { LoadingState } from "@/components/loading/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoginLoading() {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand Panel Skeleton - Desktop Only */}
      <div className="hidden w-[45%] items-center justify-center lg:flex">
        <div className="flex flex-col items-center gap-6">
          <Skeleton className="h-20 w-20 rounded-2xl" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
      </div>

      {/* Form Panel Skeleton */}
      <div className="flex w-full flex-col items-center justify-center px-4 lg:w-[55%]">
        {/* Mobile Brand Skeleton */}
        <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <LoadingState className="text-center" />
        </div>
      </div>
    </div>
  );
}
