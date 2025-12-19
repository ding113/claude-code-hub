import {
  LoadingState,
  PageHeaderSkeleton,
  SectionSkeleton,
} from "@/components/loading/page-skeletons";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton titleWidth="w-44" descriptionWidth="w-72" />
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
      <LoadingState className="text-center" />
    </div>
  );
}
