"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/routing";

interface DashboardMainProps {
  children: ReactNode;
}

export function DashboardMain({ children }: DashboardMainProps) {
  const pathname = usePathname();

  // Pattern to match /dashboard/sessions/[id]/messages
  // The usePathname hook from next-intl/routing might return the path without locale prefix if configured that way,
  // or we just check for the suffix.
  // Let's be safe and check if it includes "/dashboard/sessions/" and ends with "/messages"
  const isSessionMessagesPage =
    pathname.includes("/dashboard/sessions/") && pathname.endsWith("/messages");

  if (isSessionMessagesPage) {
    return <main className="h-[calc(100vh-64px)] w-full overflow-hidden">{children}</main>;
  }

  return <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>;
}
