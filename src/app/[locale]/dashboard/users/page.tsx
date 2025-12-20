import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard" : "/login", locale });
  }

  // TypeScript: session is guaranteed to be non-null after the redirect check
  return <UsersPageClient currentUser={session.user} />;
}
