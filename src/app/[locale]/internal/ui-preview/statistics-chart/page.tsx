import { notFound } from "next/navigation";
import { StatisticsChartPreview } from "./_components/statistics-chart-preview";

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <StatisticsChartPreview />;
}
