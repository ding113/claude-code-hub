import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "../dashboard/_components/dashboard-header";
import { PageTransition } from "./_components/page-transition";
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
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8 pb-24 md:pb-8">
        <div className="space-y-6">
          {/* Desktop: Grid layout with sidebar */}
          <div className="lg:grid lg:gap-6 lg:grid-cols-[220px_1fr]">
            {/* Desktop sidebar */}
            <aside className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
              <SettingsNav items={translatedNavItems} />
            </aside>
            {/* Content area */}
            <div className="space-y-6">
              {/* Tablet: Horizontal nav shown above content */}
              <div className="lg:hidden">
                <SettingsNav items={translatedNavItems} />
              </div>
              <PageTransition>{children}</PageTransition>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
