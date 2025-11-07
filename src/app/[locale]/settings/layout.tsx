import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "../dashboard/_components/dashboard-header";
import { SettingsNav } from "./_components/settings-nav";
import { SETTINGS_NAV_ITEMS } from "./_lib/nav-items";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login" as any);
    return null; // TypeScript doesn't know redirect throws
  }

  if (session.user.role !== "admin") {
    redirect("/dashboard" as any);
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader session={session} />
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <SettingsNav items={SETTINGS_NAV_ITEMS} />
            </aside>
            <div className="space-y-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
