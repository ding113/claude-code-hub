import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/routing";

export default async function QuotasLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">限额管理</h2>
        <p className="text-muted-foreground">查看和管理所有层级的限额使用情况</p>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <Link href="/dashboard/quotas/users">
            <TabsTrigger value="users">用户限额</TabsTrigger>
          </Link>
          <Link href="/dashboard/quotas/keys">
            <TabsTrigger value="keys">密钥限额</TabsTrigger>
          </Link>
          <Link href="/dashboard/quotas/providers">
            <TabsTrigger value="providers">供应商限额</TabsTrigger>
          </Link>
        </TabsList>

        {children}
      </Tabs>
    </div>
  );
}
