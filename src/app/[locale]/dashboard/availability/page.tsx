import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSession } from "@/lib/auth";
import { AvailabilityEndpointsView } from "./_components/availability-endpoints-view";
import { AvailabilityProvidersView } from "./_components/availability-providers-view";
import { AvailabilityViewSkeleton } from "./_components/availability-skeleton";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const t = await getTranslations("dashboard.availability");
  const session = await getSession();

  // Only admin can access availability monitoring
  const isAdmin = session?.user.role === "admin";

  if (!isAdmin) {
    const tPerm = await getTranslations("dashboard.leaderboard.permission");
    return (
      <div className="space-y-6">
        <Section title={t("title")} description={t("description")}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                {tPerm("title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tPerm("restricted")}</AlertTitle>
                <AlertDescription>{tPerm("userAction")}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")}>
        <Tabs defaultValue="providers" className="w-full">
          <TabsList>
            <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
            <TabsTrigger value="endpoints">{t("tabs.endpoints")}</TabsTrigger>
          </TabsList>
          <TabsContent value="providers" className="mt-4">
            <Suspense fallback={<AvailabilityViewSkeleton />}>
              <AvailabilityProvidersView />
            </Suspense>
          </TabsContent>
          <TabsContent value="endpoints" className="mt-4">
            <Suspense fallback={<AvailabilityViewSkeleton />}>
              <AvailabilityEndpointsView />
            </Suspense>
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
