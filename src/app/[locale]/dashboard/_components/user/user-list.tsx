"use client";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { ListContainer, ListItem, type ListItemData } from "@/components/ui/list";
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

  // 转换数据格式
  const listItems: ListItemData[] = users.map((user) => ({
    id: user.id,
    title: user.name,
    subtitle: user.note,
    badge: {
      text: t("badge", { count: user.keys.length }),
      variant: "outline" as const,
    },
    tags: user.tags,
    metadata: [
      {
        label: t("activeKeys"),
        value: user.keys.filter((k) => k.status === "enabled").length.toString(),
      },
      {
        label: t("totalKeys"),
        value: user.keys.length.toString(),
      },
    ],
  }));

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
            {listItems.map((item) => (
              <ListItem
                key={item.id}
                data={item}
                isActive={item.id === activeUserId}
                onClick={() => onUserSelect(item.id as number)}
                compact
              />
            ))}
          </div>
        ) : null}
      </ListContainer>
    </div>
  );
}
