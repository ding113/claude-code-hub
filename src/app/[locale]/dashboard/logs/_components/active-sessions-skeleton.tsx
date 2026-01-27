import { Skeleton } from "@/components/ui/skeleton";

export function ActiveSessionsSkeleton() {
  return (
    <div className="border rounded-lg bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-3 w-20" />
      </div>

      <div style={{ maxHeight: "200px" }} className="overflow-y-auto">
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-3.5 rounded-full" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-10 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
