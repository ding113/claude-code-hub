import { getProviders } from "@/actions/providers";
import { getProviderLimitUsage } from "@/actions/providers";
import { ProvidersQuotaManager } from "./_components/providers-quota-manager";
import { getSystemSettings } from "@/repository/system-config";
import { getTranslations } from "next-intl/server";

// 强制动态渲染 (此页面需要实时数据和认证)
export const dynamic = "force-dynamic";

async function getProvidersWithQuotas() {
  const providers = await getProviders();

  const providersWithQuotas = await Promise.all(
    providers.map(async (provider) => {
      const result = await getProviderLimitUsage(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        isEnabled: provider.isEnabled,
        priority: provider.priority,
        weight: provider.weight,
        quota: result.ok ? result.data : null,
      };
    })
  );

  return providersWithQuotas;
}

export default async function ProvidersQuotaPage() {
  const [providers, systemSettings] = await Promise.all([
    getProvidersWithQuotas(),
    getSystemSettings(),
  ]);
  const t = await getTranslations("quota.providers");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("totalCount", { count: providers.length })}
          </p>
        </div>
      </div>

      <ProvidersQuotaManager providers={providers} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
