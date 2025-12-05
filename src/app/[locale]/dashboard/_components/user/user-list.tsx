"use client";
import { addDays } from "date-fns";
import { Loader2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { renewUser, toggleUserEnabled } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListContainer, ListItem, type ListItemData } from "@/components/ui/list";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatDateDistance } from "@/lib/utils/date-format";
import type { User, UserDisplay } from "@/types/user";
import { AddUserDialog } from "./add-user-dialog";

interface UserListProps {
  users: UserDisplay[];
  activeUserId: number | null;
  onUserSelect: (userId: number) => void;
  currentUser?: User;
}

export function UserList({ users, activeUserId, onUserSelect, currentUser }: UserListProps) {
  const t = useTranslations("dashboard.userList");
  const tUsers = useTranslations("users");
  const locale = useLocale();
  const isAdmin = currentUser?.role === "admin";
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  // 自定义续期对话框状态
  const [customRenewDialog, setCustomRenewDialog] = useState<{
    open: boolean;
    user: UserDisplay | null;
  }>({ open: false, user: null });
  const [customDate, setCustomDate] = useState("");
  const [enableOnRenew, setEnableOnRenew] = useState(false);

  const EXPIRING_SOON_MS = 72 * 60 * 60 * 1000; // 72 hours

  // Calculate user status based on isEnabled and expiresAt
  const getStatusInfo = (user: UserDisplay, now: number) => {
    const exp = user.expiresAt ? new Date(user.expiresAt).getTime() : null;
    if (!user.isEnabled) {
      return {
        code: "disabled" as const,
        badgeVariant: "secondary" as const,
      };
    }
    if (exp && exp <= now) {
      return {
        code: "expired" as const,
        badgeVariant: "destructive" as const,
      };
    }
    if (exp && exp - now <= EXPIRING_SOON_MS) {
      return {
        code: "expiringSoon" as const,
        badgeVariant: "outline" as const,
      };
    }
    return {
      code: "active" as const,
      badgeVariant: "default" as const,
    };
  };

  // Format expiration time
  const formatExpiry = (expiresAt: Date | null | undefined) => {
    if (!expiresAt) return tUsers("neverExpires");
    const relative = formatDateDistance(expiresAt, new Date(), locale, { addSuffix: true });
    const absolute = formatDate(expiresAt, "yyyy-MM-dd", locale);
    return `${relative} · ${absolute}`;
  };

  // Handle renew user
  const handleRenew = (userId: number, targetDate: Date, enableUser?: boolean) => {
    startTransition(async () => {
      setPendingUserId(userId);
      try {
        const res = await renewUser(userId, {
          expiresAt: targetDate.toISOString(),
          enableUser,
        });
        if (!res.ok) {
          toast.error(res.error || t("actions.failed"));
          return;
        }
        toast.success(t("actions.success"));
      } catch (error) {
        console.error("[UserList] renewUser failed", error);
        toast.error(t("actions.failed"));
      } finally {
        setPendingUserId(null);
      }
    });
  };

  // Handle toggle user enabled status
  const handleToggle = (user: UserDisplay, enabled: boolean) => {
    startTransition(async () => {
      setPendingUserId(user.id);
      try {
        const res = await toggleUserEnabled(user.id, enabled);
        if (!res.ok) {
          toast.error(res.error || t("actions.failed"));
          return;
        }
        toast.success(t("actions.success"));
      } catch (error) {
        console.error("[UserList] toggleUserEnabled failed", error);
        toast.error(t("actions.failed"));
      } finally {
        setPendingUserId(null);
      }
    });
  };

  // Handle custom renew with date dialog
  const handleCustomRenew = (user: UserDisplay) => {
    setCustomRenewDialog({ open: true, user });
    setCustomDate("");
    setEnableOnRenew(!user.isEnabled); // 如果用户已禁用，默认勾选启用
  };

  // 确认自定义续期
  const handleConfirmCustomRenew = () => {
    if (!customRenewDialog.user || !customDate) {
      toast.error(t("actions.invalidDate"));
      return;
    }
    const parsed = new Date(customDate);
    if (Number.isNaN(parsed.getTime())) {
      toast.error(t("actions.invalidDate"));
      return;
    }
    handleRenew(customRenewDialog.user.id, parsed, enableOnRenew ? true : undefined);
    setCustomRenewDialog({ open: false, user: null });
  };

  const now = Date.now();

  // Transform user data to list items
  const listItems: Array<{ user: UserDisplay; item: ListItemData }> = useMemo(
    () =>
      users.map((user) => {
        const statusInfo = getStatusInfo(user, now);
        const activeKeys = user.keys.filter((k) => k.status === "enabled").length;
        return {
          user,
          item: {
            id: user.id,
            title: user.name,
            subtitle: user.note,
            badge: {
              text: t(`status.${statusInfo.code}`),
              variant: statusInfo.badgeVariant,
            },
            tags: user.tags,
            metadata: [
              {
                label: t("activeKeys"),
                value: activeKeys.toString(),
              },
              {
                label: t("totalKeys"),
                value: user.keys.length.toString(),
              },
              {
                label: t("expiresAt"),
                value: formatExpiry(user.expiresAt ?? null),
              },
            ],
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, now, locale, t, tUsers]
  );

  // 特别设计的空状态 - 仅管理员可见
  const emptyStateComponent =
    currentUser?.role === "admin" ? (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="rounded-full bg-muted/50 p-6 mb-4">
          <Users className="h-12 w-12 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{t("emptyState.title")}</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">{t("emptyState.description")}</p>
        <AddUserDialog variant="default" size="lg" currentUser={currentUser} />
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      <ListContainer
        maxHeight="none"
        title={t("title")}
        actions={
          currentUser?.role === "admin" && users.length > 0 ? (
            <AddUserDialog variant="outline" size="sm" currentUser={currentUser} />
          ) : undefined
        }
        emptyState={
          users.length === 0
            ? {
                title: "",
                description: "",
                action: emptyStateComponent,
              }
            : undefined
        }
      >
        {users.length > 0 ? (
          <div className="space-y-2">
            {listItems.map(({ user, item }) => (
              <ListItem
                key={item.id}
                data={item}
                isActive={item.id === activeUserId}
                onClick={() => onUserSelect(item.id as number)}
                compact
                actions={
                  isAdmin ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending && pendingUserId === user.id}
                          >
                            {t("actions.renew")}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onClick={() =>
                              handleRenew(
                                user.id,
                                addDays(new Date(), 30),
                                user.isEnabled ? undefined : true
                              )
                            }
                          >
                            {t("actions.renew30d")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleRenew(
                                user.id,
                                addDays(new Date(), 90),
                                user.isEnabled ? undefined : true
                              )
                            }
                          >
                            {t("actions.renew90d")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              handleRenew(
                                user.id,
                                addDays(new Date(), 365),
                                user.isEnabled ? undefined : true
                              )
                            }
                          >
                            {t("actions.renew1y")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleCustomRenew(user)}>
                            {t("actions.renewCustom")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="sm"
                        variant={user.isEnabled ? "outline" : "default"}
                        disabled={isPending && pendingUserId === user.id}
                        onClick={() => handleToggle(user, !user.isEnabled)}
                      >
                        {isPending && pendingUserId === user.id && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {user.isEnabled ? t("actions.disable") : t("actions.enable")}
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : null}
      </ListContainer>

      {/* 自定义续期对话框 */}
      <Dialog
        open={customRenewDialog.open}
        onOpenChange={(open) => {
          if (!open) setCustomRenewDialog({ open: false, user: null });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("actions.customRenewTitle")}</DialogTitle>
            <DialogDescription>
              {t("actions.customRenewDescription", {
                userName: customRenewDialog.user?.name || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-date">{t("actions.expirationDate")}</Label>
              <Input
                id="custom-date"
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>
            {customRenewDialog.user && !customRenewDialog.user.isEnabled && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="enable-on-renew"
                  checked={enableOnRenew}
                  onCheckedChange={setEnableOnRenew}
                />
                <Label htmlFor="enable-on-renew" className="text-sm font-normal cursor-pointer">
                  {t("actions.enableOnRenew")}
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCustomRenewDialog({ open: false, user: null })}
            >
              {t("actions.cancel")}
            </Button>
            <Button onClick={handleConfirmCustomRenew} disabled={!customDate}>
              {t("actions.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
