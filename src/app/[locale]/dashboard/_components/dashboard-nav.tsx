"use client";

import { Link, usePathname } from "@/i18n/routing";

import { cn } from "@/lib/utils";

export interface DashboardNavItem {
  href: string;
  label: string;
  external?: boolean;
}

interface DashboardNavProps {
  items: DashboardNavItem[];
}

export function DashboardNav({ items }: DashboardNavProps) {
  const pathname = usePathname();

  if (items.length === 0) {
    return null;
  }

  const getIsActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }

    return pathname.startsWith(href);
  };

  return (
    <nav className="flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {items.map((item) => {
        const isActive = getIsActive(item.href);
        const className = cn(
          "rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
          isActive && "bg-primary/5 text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
        );

        if (item.external) {
          return (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {item.label}
            </a>
          );
        }

        return (
          <Link key={item.href} href={item.href} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
