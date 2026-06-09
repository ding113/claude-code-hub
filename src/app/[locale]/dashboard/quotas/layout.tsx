import { getTranslations } from "next-intl/server";
import { QuotaTabsNav } from "./_components/quota-tabs-nav";

export default async function QuotasLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "quota.layout" });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <QuotaTabsNav />

      <div className="space-y-4">{children}</div>
    </div>
  );
}
