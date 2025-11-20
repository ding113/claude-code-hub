"use client";
import type { UserDisplay } from "@/types/user";
import type { User } from "@/types/user";
import { ListContainer, ListItem, ListItemData } from "@/components/ui/list";
import { AddUserDialog } from "./add-user-dialog";
import { useTranslations } from "next-intl";

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

  return (
    <div className="space-y-3">
      <ListContainer
        emptyState={{
          title: t("emptyState.title"),
          description: t("emptyState.description"),
        }}
      >
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
      </ListContainer>

      {/* 新增用户按钮：列表下方、与列表同宽，中性配色 - 仅管理员可见 */}
      {currentUser?.role === "admin" && (
        <AddUserDialog variant="secondary" className="w-full" currentUser={currentUser} />
      )}
    </div>
  );
}
