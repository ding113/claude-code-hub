import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { AvailabilityView } from "./_components/availability-view";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const t = await getTranslations("dashboard");
  const session = await getSession();

  // Only admin can access availability monitoring
  const isAdmin = session?.user.role === "admin";

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Section title={t("availability.title")} description={t("availability.description")}>
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
      <Section title={t("availability.title")} description={t("availability.description")}>
        <AvailabilityView />
      </Section>
    </div>
  );
}
