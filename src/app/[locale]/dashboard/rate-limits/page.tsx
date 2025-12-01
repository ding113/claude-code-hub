import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { RateLimitDashboard } from "./_components/rate-limit-dashboard";

export const dynamic = "force-dynamic";

export default async function RateLimitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 仅管理员可访问
  if (!session || session.user.role !== "admin") {
    return redirect({ href: "/dashboard", locale });
  }

  const t = await getTranslations("dashboard.rateLimits");
  const systemSettings = await getSystemSettings();

  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")}>
        <RateLimitDashboard currencyCode={systemSettings.currencyDisplay} />
      </Section>
    </div>
  );
}
