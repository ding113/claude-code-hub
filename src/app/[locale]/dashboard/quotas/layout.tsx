import { getTranslations } from "next-intl/server";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/routing";

export default async function QuotasLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("quota.layout");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <Link href="/dashboard/quotas/users">
            <TabsTrigger value="users">{t("tabs.users")}</TabsTrigger>
          </Link>
          <Link href="/dashboard/quotas/providers">
            <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
          </Link>
        </TabsList>

        {children}
      </Tabs>
    </div>
  );
}
