"use client";

import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "@/i18n/routing";

interface UserMenuProps {
  user: {
    id: number;
    name: string;
    description?: string | null;
    role: string;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations("dashboard.nav");
  const router = useRouter();
  const canOpenSettings = user.role === "admin";

  const handleLogout = () => {
    // 立即跳转到登录页面，避免延迟
    router.push("/login");
    // 异步调用登出接口，不等待响应
    fetch("/api/auth/logout", { method: "POST" }).then(() => {
      router.refresh();
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold text-xs">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-foreground/90">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canOpenSettings ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Settings className="h-4 w-4" />
                <span>{t("settings")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuItem onSelect={() => router.push("/settings/security")}>
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t("securitySettings")}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
          <LogOut className="h-4 w-4" />
          <span>{t("logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
