import { LoadingState, SectionSkeleton } from "@/components/loading/page-skeletons";

export function SettingsConfigSkeleton() {
  return (
    <div className="space-y-6">
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
      <LoadingState className="text-center" />
    </div>
  );
}
