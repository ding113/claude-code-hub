// This page has been deprecated. Key-level quotas are now managed at user level.
// Users should visit /dashboard/quotas/users instead.
// Redirecting to user quotas page...

import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";

export default async function KeysQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    redirect({ href: session ? "/dashboard/my-quota" : "/login", locale });
  }

  redirect({ href: "/dashboard/quotas/users", locale });
}
