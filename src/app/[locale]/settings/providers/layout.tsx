import { getTranslations } from "next-intl/server";
import { ProvidersTabs } from "./_components/providers-tabs";

export default async function ProvidersLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("settings.providers.tabs");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
      </div>

      <ProvidersTabs>{children}</ProvidersTabs>
    </div>
  );
}
