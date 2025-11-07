import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "./_components/dashboard-header";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login?from=/dashboard" as any);
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader session={session} />
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
