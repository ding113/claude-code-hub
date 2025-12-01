import { getTranslations } from "next-intl/server";
import { getProviderLimitUsageBatch, getProviders } from "@/actions/providers";
import { getSystemSettings } from "@/repository/system-config";
import { ProvidersQuotaManager } from "./_components/providers-quota-manager";

// 强制动态渲染 (此页面需要实时数据和认证)
export const dynamic = "force-dynamic";

async function getProvidersWithQuotas() {
  const providers = await getProviders();

  // 使用批量查询获取所有供应商的限额数据（避免 N+1 查询问题）
  // 优化前: 50 个供应商 = 52 DB + 250 Redis 查询
  // 优化后: 50 个供应商 = 2 DB + 2 Redis Pipeline 查询
  const quotaMap = await getProviderLimitUsageBatch(
    providers.map((p) => ({
      id: p.id,
      dailyResetTime: p.dailyResetTime,
      dailyResetMode: p.dailyResetMode,
      limit5hUsd: p.limit5hUsd,
      limitDailyUsd: p.limitDailyUsd,
      limitWeeklyUsd: p.limitWeeklyUsd,
      limitMonthlyUsd: p.limitMonthlyUsd,
      limitConcurrentSessions: p.limitConcurrentSessions,
    }))
  );

  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    weight: provider.weight,
    quota: quotaMap.get(provider.id) ?? null,
  }));
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
