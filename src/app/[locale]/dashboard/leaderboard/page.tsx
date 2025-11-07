import { Section } from "@/components/section";
import { LeaderboardView } from "./_components/leaderboard-view";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
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
        <Section title="消耗排行榜" description="查看用户消耗排名，数据每 5 分钟更新一次">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                需要权限
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>访问受限</AlertTitle>
                <AlertDescription>
                  排行榜功能需要管理员开启&nbsp;&quot;允许查看全站使用量&quot;&nbsp;权限。
                  {isAdmin && (
                    <span>
                      请前往{" "}
                      <Link href="/settings/config" className="underline font-medium">
                        系统设置
                      </Link>{" "}
                      开启此权限。
                    </span>
                  )}
                  {!isAdmin && <span>请联系管理员开启此权限。</span>}
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
      <Section title="消耗排行榜" description="查看用户消耗排名，数据每 5 分钟更新一次">
        <LeaderboardView isAdmin={isAdmin} />
      </Section>
    </div>
  );
}
