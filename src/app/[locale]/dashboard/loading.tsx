import {
  LoadingState,
  PageHeaderSkeleton,
  SectionSkeleton,
  TableSkeleton,
} from "@/components/loading/page-skeletons";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton titleWidth="w-52" descriptionWidth="w-80" />
      <SectionSkeleton body={<TableSkeleton rows={5} columns={4} />} />
      <SectionSkeleton rows={4} />
      <LoadingState className="text-center" />
    </div>
  );
}
