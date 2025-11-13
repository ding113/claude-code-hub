"use client";
import { useState } from "react";
import type { UserDisplay } from "@/types/user";
import type { User } from "@/types/user";
import { ListContainer, ListItem, ListItemData } from "@/components/ui/list";
import { AddUserDialog } from "./add-user-dialog";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/lib/hooks/use-debounce";

interface UserListProps {
  users: UserDisplay[];
  activeUserId: number | null;
  onUserSelect: (userId: number) => void;
  currentUser?: User;
}

export function UserList({ users, activeUserId, onUserSelect, currentUser }: UserListProps) {
  const t = useTranslations("dashboard.userList");

  // 标签筛选状态
  const [tagFilter, setTagFilter] = useState("");
  const debouncedTagFilter = useDebounce(tagFilter, 500);

  // 客户端标签筛选逻辑
  const filteredUsers = users.filter((user) => {
    if (!debouncedTagFilter) return true;

    // 如果用户没有标签，不匹配任何筛选
    if (!user.tags || user.tags.length === 0) return false;

    // 匹配包含任一输入标签关键词的用户（不区分大小写）
    return user.tags.some((tag) =>
      tag.toLowerCase().includes(debouncedTagFilter.toLowerCase())
    );
  });

  // 转换数据格式
  const listItems: ListItemData[] = filteredUsers.map((user) => ({
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

  // 清空筛选
  const handleClearFilter = () => {
    setTagFilter("");
  };

  return (
    <div className="space-y-3">
      {/* 标签筛选输入框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("tagFilterPlaceholder")}
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="pl-9 pr-20"
        />
        {tagFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilter}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2"
          >
            <X className="h-4 w-4 mr-1" />
            {t("clearFilter")}
          </Button>
        )}
      </div>

      <ListContainer
        emptyState={{
          title: debouncedTagFilter ? t("emptyState.noMatch") : t("emptyState.title"),
          description: debouncedTagFilter ? t("emptyState.noMatchDescription") : t("emptyState.description"),
        }}
      >
        <div className="space-y-2">
          {listItems.map((item) => {
            const user = filteredUsers.find((u) => u.id === item.id);
            return (
              <div key={item.id} className="space-y-2">
                <ListItem
                  data={item}
                  isActive={item.id === activeUserId}
                  onClick={() => onUserSelect(item.id as number)}
                  compact
                />
                {/* 展示用户标签 */}
                {user && user.tags && user.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    {user.tags.map((tag, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ListContainer>

      {/* 新增用户按钮：列表下方、与列表同宽，中性配色 - 仅管理员可见 */}
      {currentUser?.role === "admin" && <AddUserDialog variant="secondary" className="w-full" />}
    </div>
  );
}
