import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { SessionMessagesClient } from "./_components/session-messages-client";

export const dynamic = "force-dynamic";

export default async function SessionMessagesPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard" : "/login", locale });
  }

  return <SessionMessagesClient />;
}
