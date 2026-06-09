import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { listUserGroups } from "@/actions/user-group";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getAllUserTags } from "@/repository/user";
import { UserGroupClient } from "./_components/user-group-client";

export const dynamic = "force-dynamic";

export default async function UserGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard/my-quota" : "/login", locale });
  }

  const t = await getTranslations({ locale, namespace: "quota.userGroups" });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Suspense
        fallback={<div className="py-8 text-center text-muted-foreground">{t("loading")}</div>}
      >
        <UserGroupsContent locale={locale} />
      </Suspense>
    </div>
  );
}

async function UserGroupsContent({ locale: _locale }: { locale: string }) {
  const [groupsResult, availableTags] = await Promise.all([listUserGroups(), getAllUserTags()]);

  const groups = groupsResult.ok ? groupsResult.data : [];

  return <UserGroupClient groups={groups} availableTags={availableTags} />;
}
