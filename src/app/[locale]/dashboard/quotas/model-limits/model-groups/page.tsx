import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { listModelGroups } from "@/repository/model-group";
import { findAllProviderSupportedModels } from "@/repository/provider";
import { ModelGroupClient } from "./_components/model-group-client";

export const dynamic = "force-dynamic";

export default async function ModelGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard/my-quota" : "/login", locale });
  }

  const t = await getTranslations({ locale, namespace: "quota.modelGroups" });

  const [groups, availableModels] = await Promise.all([
    listModelGroups(),
    findAllProviderSupportedModels(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>{t("semanticsNote")}</AlertDescription>
      </Alert>

      <ModelGroupClient initialGroups={groups} availableModels={availableModels} />
    </div>
  );
}
