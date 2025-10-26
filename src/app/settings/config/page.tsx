import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { getSystemSettings } from "@/repository/system-config";
import { SystemSettingsForm } from "./_components/system-settings-form";
import { AutoCleanupForm } from "./_components/auto-cleanup-form";

export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const settings = await getSystemSettings();

  return (
    <>
      <SettingsPageHeader
        title="基础配置"
        description="管理系统的基础参数，影响站点显示和统计行为。"
      />

      <Section title="站点参数" description="配置站点标题、货币显示单位与仪表盘统计展示策略。">
        <SystemSettingsForm
          initialSettings={{
            siteTitle: settings.siteTitle,
            allowGlobalUsageView: settings.allowGlobalUsageView,
            currencyDisplay: settings.currencyDisplay,
          }}
        />
      </Section>

      <Section
        title="自动日志清理"
        description="定时自动清理历史日志数据，释放数据库存储空间。"
      >
        <AutoCleanupForm settings={settings} />
      </Section>
    </>
  );
}
