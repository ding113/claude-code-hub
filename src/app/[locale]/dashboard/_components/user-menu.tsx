"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface UserMenuProps {
  user: {
    id: number;
    name: string;
    description?: string | null;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations("dashboard.nav");
  const router = useRouter();

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
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-semibold text-xs">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground/90">{user.name}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleLogout}
        className="h-9 w-9 rounded-full hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
        title={t("logout")}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
