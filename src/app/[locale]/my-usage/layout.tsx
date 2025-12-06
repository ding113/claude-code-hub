import type { ReactNode } from "react";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";

export default async function MyUsageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession({ allowReadOnlyAccess: true });

  if (!session) {
    return redirect({ href: "/login?from=/my-usage", locale });
  }

  if (session.user.role === "admin" || session.key.canLoginWebUi) {
    return redirect({ href: "/dashboard", locale });
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
