import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getMyQuota } from "@/actions/my-usage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getSystemSettings } from "@/repository/system-config";
import { QuotaCards } from "../../my-usage/_components/quota-cards";

export const dynamic = "force-dynamic";

export default async function MyQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  await params;

  const [quotaResult, systemSettings, tNav, tCommon] = await Promise.all([
    getMyQuota(),
    getSystemSettings(),
    getTranslations("dashboard.nav"),
    getTranslations("common"),
  ]);

  // Handle error state
  if (!quotaResult.ok) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">{tNav("myQuota")}</h3>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{tCommon("error")}</AlertTitle>
          <AlertDescription>{quotaResult.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{tNav("myQuota")}</h3>
      </div>

      <QuotaCards quota={quotaResult.data} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
