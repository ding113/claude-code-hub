import { notFound } from "next/navigation";
import { StatisticsChartPreview } from "@/app/[locale]/internal/ui-preview/statistics-chart/_components/statistics-chart-preview";

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <StatisticsChartPreview />;
}
