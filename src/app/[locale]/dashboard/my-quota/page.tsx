import { getTranslations } from "next-intl/server";
import { getMyQuota } from "@/actions/my-usage";
import { getSystemSettings } from "@/repository/system-config";
import { QuotaCards } from "../../my-usage/_components/quota-cards";

export const dynamic = "force-dynamic";

export default async function MyQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  await params;

  const [quotaResult, systemSettings, tNav] = await Promise.all([
    getMyQuota(),
    getSystemSettings(),
    getTranslations("dashboard.nav"),
  ]);

  const quota = quotaResult.ok ? quotaResult.data : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{tNav("myQuota")}</h3>
        </div>
      </div>

      <QuotaCards quota={quota} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
