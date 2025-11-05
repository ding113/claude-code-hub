import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchClientVersionStats } from "@/actions/client-versions";
import { fetchSystemSettings } from "@/actions/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { ClientVersionToggle } from "./_components/client-version-toggle";
import { ClientVersionStatsTable } from "./_components/client-version-stats-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ClientVersionsPage() {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    redirect("/login");
  }

  const [statsResult, settingsResult] = await Promise.all([
    fetchClientVersionStats(),
    fetchSystemSettings(),
  ]);

  const stats = statsResult.ok ? statsResult.data : [];
  const enableClientVersionCheck = settingsResult.ok
    ? settingsResult.data.enableClientVersionCheck
    : false;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="客户端升级提醒"
        description="管理客户端版本要求，确保用户使用最新的稳定版本"
      />

      {/* 功能开关和说明 */}
      <Card>
        <CardHeader>
          <CardTitle>升级提醒设置</CardTitle>
          <CardDescription>启用后，系统将自动检测客户端版本并拦截旧版本用户的请求</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientVersionToggle enabled={enableClientVersionCheck} />
        </CardContent>
      </Card>

      {/* 版本统计表格 */}
      <Card>
        <CardHeader>
          <CardTitle>客户端版本分布</CardTitle>
          <CardDescription>显示过去 7 天内活跃用户的客户端版本信息</CardDescription>
        </CardHeader>
        <CardContent>
          {stats && stats.length > 0 ? (
            <ClientVersionStatsTable data={stats} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">暂无客户端数据</p>
              <p className="mt-2 text-sm text-muted-foreground">
                过去 7 天内没有活跃用户使用可识别的客户端
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
