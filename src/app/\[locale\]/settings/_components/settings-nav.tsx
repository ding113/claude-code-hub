"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { SettingsNavItem } from "../_lib/nav-items";

interface SettingsNavProps {
  items: SettingsNavItem[];
}

export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname();

  if (items.length === 0) {
    return null;
  }

  const getIsActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="rounded-xl border border-border/80 bg-card/70 p-1 backdrop-blur supports-[backdrop-filter]:bg-card/50">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = getIsActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:text-foreground",
                  isActive && "bg-primary/5 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)]"
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
