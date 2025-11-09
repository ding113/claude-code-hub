import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "../dashboard/_components/dashboard-header";
import { SettingsNav } from "./_components/settings-nav";
import { getTranslatedNavItems } from "./_lib/nav-items";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();

  if (!session) {
    return redirect({ href: "/login", locale });
  }

  if (session.user.role !== "admin") {
    return redirect({ href: "/dashboard", locale });
  }

  // Get translated navigation items
  const translatedNavItems = await getTranslatedNavItems();

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader session={session} />
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <SettingsNav items={translatedNavItems} />
            </aside>
            <div className="space-y-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
