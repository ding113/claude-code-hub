import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { isModelRateLimitEnabled } from "@/lib/model-rate-limit/types";
import type { ModelGroupWithMembers } from "@/repository/model-group";
import { listModelGroups } from "@/repository/model-group";
import type { ModelGroupLimitRecord } from "@/repository/model-group-limit";
import { listModelGroupLimits } from "@/repository/model-group-limit";
import { listAllActiveAndFutureGrants } from "@/repository/quota-boost";
import { getSystemSettings } from "@/repository/system-config";
import { searchUsersForFilter } from "@/repository/user";
import type { UserGroupRow } from "@/repository/user-group";
import { listUserGroupMembers, listUserGroups } from "@/repository/user-group";
import { ModelLimitsClient } from "./_components/model-limits-client";

export const dynamic = "force-dynamic";

export interface UserItem {
  id: number;
  name: string;
}

export interface PageInitialData {
  modelGroups: ModelGroupWithMembers[];
  userGroups: UserGroupRow[];
  users: UserItem[];
  initialLimits: ModelGroupLimitRecord[];
  currencyCode: string;
  featureEnabled: boolean;
  userGroupMembers: Record<number, UserItem[]>;
  boostCounts: Record<string, number>;
}

export default async function ModelLimitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard/my-quota" : "/login", locale });
  }

  const t = await getTranslations({ locale, namespace: "quota.modelLimits" });

  const [modelGroups, userGroups, users, initialLimits, systemSettings, boostGrants] =
    await Promise.all([
      listModelGroups(),
      listUserGroups(),
      searchUsersForFilter(undefined, 2000),
      listModelGroupLimits({}),
      getSystemSettings(),
      listAllActiveAndFutureGrants(),
    ]);

  const featureEnabled = isModelRateLimitEnabled();

  const boostCounts: Record<string, number> = {};
  for (const grant of boostGrants) {
    const key = `${grant.userId}:${grant.modelGroupId}`;
    boostCounts[key] = (boostCounts[key] ?? 0) + 1;
  }

  const memberRows = await listUserGroupMembers(userGroups.map((g) => g.tag));
  const tagToGroupId = new Map(userGroups.map((g) => [g.tag, g.id]));
  const userGroupMembers: Record<number, UserItem[]> = {};
  for (const member of memberRows) {
    const groupId = tagToGroupId.get(member.tag);
    if (groupId === undefined) continue;
    (userGroupMembers[groupId] ??= []).push({ id: member.userId, name: member.userName });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {!featureEnabled && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{t("disabledNotice")}</AlertDescription>
        </Alert>
      )}

      <ModelLimitsClient
        modelGroups={modelGroups}
        userGroups={userGroups}
        users={users}
        initialLimits={initialLimits}
        currencyCode={systemSettings.currencyDisplay}
        featureEnabled={featureEnabled}
        userGroupMembers={userGroupMembers}
        boostCounts={boostCounts}
      />
    </div>
  );
}
