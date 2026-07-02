import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "./_components/dashboard-header";
import { DashboardMain } from "./_components/dashboard-main";
import { WebhookMigrationDialog } from "./_components/webhook-migration-dialog";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, session] = await Promise.all([params, getSession()]);

  if (!session) {
    return redirect({ href: "/login?from=/dashboard", locale });
  }

  if (session.user.role !== "admin" && !session.key.canLoginWebUi) {
    return redirect({ href: "/my-usage", locale });
  }

  return (
    <div className="min-h-[var(--cch-viewport-height,100vh)] bg-background">
      <DashboardHeader session={session} locale={locale} />
      <DashboardMain>{children}</DashboardMain>
      <WebhookMigrationDialog />
    </div>
  );
}
