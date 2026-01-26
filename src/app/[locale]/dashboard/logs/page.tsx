import { Suspense } from "react";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { ActiveSessionsSkeleton } from "./_components/active-sessions-skeleton";
import {
  UsageLogsActiveSessionsSection,
  UsageLogsDataSection,
} from "./_components/usage-logs-sections";
import { UsageLogsSkeleton } from "./_components/usage-logs-skeleton";

export const dynamic = "force-dynamic";

export default async function UsageLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;

  const session = await getSession();
  if (!session) {
    return redirect({ href: "/login", locale });
  }

  const isAdmin = session.user.role === "admin";

  return (
    <div className="space-y-4">
      {/* Active Sessions - Horizontal scrolling cards */}
      <Suspense fallback={<ActiveSessionsSkeleton />}>
        <UsageLogsActiveSessionsSection />
      </Suspense>

      {/* Stats + Filters + Logs Table */}
      <Suspense fallback={<UsageLogsSkeleton />}>
        <UsageLogsDataSection
          isAdmin={isAdmin}
          userId={session.user.id}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  );
}
