"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/routing";

interface DashboardMainProps {
  children: ReactNode;
}

export function DashboardMain({ children }: DashboardMainProps) {
  const pathname = usePathname();

  const normalizedPathname = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  // Pattern to match /dashboard/sessions/[id]/messages
  // The usePathname hook from next-intl/routing might return the path without locale prefix if configured that way,
  // or we just check for the suffix.
  // Let's be safe and check if it includes "/dashboard/sessions/" and ends with "/messages"
  const isSessionMessagesPage =
    normalizedPathname.includes("/dashboard/sessions/") && normalizedPathname.endsWith("/messages");

  const isDashboardHomePage =
    normalizedPathname === "/dashboard" || normalizedPathname.endsWith("/dashboard");

  if (isSessionMessagesPage) {
    return <main className="h-[calc(100vh-64px)] w-full overflow-hidden">{children}</main>;
  }

  if (isDashboardHomePage) {
    return <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>;
  }

  return <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>;
}
