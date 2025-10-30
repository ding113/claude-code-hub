import { getProviders } from "@/actions/providers";
import { getProviderLimitUsage } from "@/actions/providers";
import { ProvidersQuotaManager } from "./_components/providers-quota-manager";
import { getSystemSettings } from "@/repository/system-config";

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">供应商限额统计</h3>
          <p className="text-sm text-muted-foreground">共 {providers.length} 个供应商</p>
        </div>
      </div>

      <ProvidersQuotaManager providers={providers} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
