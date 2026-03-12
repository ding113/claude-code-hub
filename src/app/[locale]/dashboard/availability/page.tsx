import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { AvailabilityDashboard } from "./_components/availability-dashboard";
import { AvailabilityDashboardSkeleton } from "./_components/availability-skeleton";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const t = await getTranslations("dashboard");
  const session = await getSession();

  // Only admin can access availability monitoring
  const isAdmin = session?.user.role === "admin";

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("availability.title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("availability.description")}</p>
        </div>
        <Section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                {t("leaderboard.permission.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("leaderboard.permission.restricted")}</AlertTitle>
                <AlertDescription>{t("leaderboard.permission.userAction")}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("availability.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("availability.description")}</p>
      </div>
      <Section>
        <Suspense fallback={<AvailabilityDashboardSkeleton />}>
          <AvailabilityDashboard />
        </Suspense>
      </Section>
    </div>
  );
}
