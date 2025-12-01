import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { LeaderboardView } from "./_components/leaderboard-view";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const t = await getTranslations("dashboard");
  // 获取用户 session 和系统设置
  const session = await getSession();
  const systemSettings = await getSystemSettings();

  // 检查权限
  const isAdmin = session?.user.role === "admin";
  const hasPermission = isAdmin || systemSettings.allowGlobalUsageView;

  // 无权限时显示友好提示
  if (!hasPermission) {
    return (
      <div className="space-y-6">
        <Section title={t("title.costRanking")} description={t("title.costRankingDescription")}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                {t("leaderboard.permission.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("leaderboard.permission.restricted")}</AlertTitle>
                <AlertDescription>
                  {t("leaderboard.permission.description")}
                  {isAdmin && (
                    <span>
                      {" "}
                      <Link href="/settings/config" className="underline font-medium">
                        {t("leaderboard.permission.systemSettings")}
                      </Link>{" "}
                      {t("leaderboard.permission.adminAction")}
                    </span>
                  )}
                  {!isAdmin && <span> {t("leaderboard.permission.userAction")}</span>}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </Section>
      </div>
    );
  }

  // 有权限时渲染排行榜
  return (
    <div className="space-y-6">
      <Section title={t("title.costRanking")} description={t("title.costRankingDescription")}>
        <LeaderboardView isAdmin={isAdmin} />
      </Section>
    </div>
  );
}
