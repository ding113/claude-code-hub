import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Section } from "@/components/section";
import { getEnvConfig } from "@/lib/config/env.schema";
import { getSystemSettings } from "@/repository/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AutoCleanupForm } from "./_components/auto-cleanup-form";
import { SettingsConfigSkeleton } from "./_components/settings-config-skeleton";
import { SystemSettingsForm } from "./_components/system-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsConfigPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });

  return (
    <>
      <SettingsPageHeader
        title={t("config.title")}
        description={t("config.description")}
        icon="settings"
      />
      <Suspense fallback={<SettingsConfigSkeleton />}>
        <SettingsConfigContent locale={locale} />
      </Suspense>
    </>
  );
}

async function SettingsConfigContent({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "settings" });
  const settings = await getSystemSettings();
  const sessionTtlSeconds = Math.max(1, Math.floor(getEnvConfig().SESSION_TTL));

  return (
    <>
      <Section
        title={t("config.section.siteParams.title")}
        description={t("config.section.siteParams.description")}
        icon="settings"
        variant="default"
      >
        <SystemSettingsForm
          sessionTtlSeconds={sessionTtlSeconds}
          initialSettings={{
            siteTitle: settings.siteTitle,
            allowGlobalUsageView: settings.allowGlobalUsageView,
            currencyDisplay: settings.currencyDisplay,
            billingModelSource: settings.billingModelSource,
            codexPriorityBillingSource: settings.codexPriorityBillingSource,
            billNonSuccessfulRequests: settings.billNonSuccessfulRequests,
            billHedgeLosers: settings.billHedgeLosers,
            discoveryEnabled: settings.discoveryEnabled,
            discoveryConcurrency: settings.discoveryConcurrency,
            maxDiscoveryRounds: settings.maxDiscoveryRounds,
            discoverySlaMs: settings.discoverySlaMs,
            stickySlaMs: settings.stickySlaMs,
            racingTotalTimeoutMs: settings.racingTotalTimeoutMs,
            stickyTimeoutCooldownMs: settings.stickyTimeoutCooldownMs,
            timezone: settings.timezone,
            verboseProviderError: settings.verboseProviderError,
            passThroughUpstreamErrorMessage: settings.passThroughUpstreamErrorMessage,
            enableHttp2: settings.enableHttp2,
            enableOpenaiResponsesWebsocket: settings.enableOpenaiResponsesWebsocket,
            enableHighConcurrencyMode: settings.enableHighConcurrencyMode,
            interceptAnthropicWarmupRequests: settings.interceptAnthropicWarmupRequests,
            enableThinkingSignatureRectifier: settings.enableThinkingSignatureRectifier,
            enableThinkingBudgetRectifier: settings.enableThinkingBudgetRectifier,
            enableThinkingEffortConflictRectifier: settings.enableThinkingEffortConflictRectifier,
            enableGeminiFunctionIdRectifier: settings.enableGeminiFunctionIdRectifier,
            enableBillingHeaderRectifier: settings.enableBillingHeaderRectifier,
            enableResponseInputRectifier: settings.enableResponseInputRectifier,
            allowNonConversationEndpointProviderFallback:
              settings.allowNonConversationEndpointProviderFallback,
            fakeStreamingWhitelist: settings.fakeStreamingWhitelist,
            streamGateMode: settings.streamGateMode,
            affinityIgnoreClientSessionId: settings.affinityIgnoreClientSessionId,
            replayEnabled: settings.replayEnabled,
            cacheEffectivenessEnabled: settings.cacheEffectivenessEnabled,
            enableCodexSessionIdCompletion: settings.enableCodexSessionIdCompletion,
            enableClaudeMetadataUserIdInjection: settings.enableClaudeMetadataUserIdInjection,
            enableResponseFixer: settings.enableResponseFixer,
            responseFixerConfig: settings.responseFixerConfig,
            quotaDbRefreshIntervalSeconds: settings.quotaDbRefreshIntervalSeconds,
            quotaLeasePercent5h: settings.quotaLeasePercent5h,
            quotaLeasePercentDaily: settings.quotaLeasePercentDaily,
            quotaLeasePercentWeekly: settings.quotaLeasePercentWeekly,
            quotaLeasePercentMonthly: settings.quotaLeasePercentMonthly,
            quotaLeaseCapUsd: settings.quotaLeaseCapUsd,
            ipGeoLookupEnabled: settings.ipGeoLookupEnabled,
            ipExtractionConfig: settings.ipExtractionConfig,
          }}
        />
      </Section>

      <Section
        title={t("config.section.autoCleanup.title")}
        description={t("config.section.autoCleanup.description")}
        icon="trash"
        iconColor="text-red-400"
        variant="default"
      >
        <AutoCleanupForm settings={settings} />
      </Section>
    </>
  );
}
