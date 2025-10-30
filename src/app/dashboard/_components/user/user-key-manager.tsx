"use client";
import { useState } from "react";
import { UserList } from "./user-list";
import { KeyListHeader } from "./key-list-header";
import { KeyList } from "./key-list";
import type { UserDisplay } from "@/types/user";
import type { User } from "@/types/user";
import type { CurrencyCode } from "@/lib/utils/currency";

interface UserKeyManagerProps {
  users: UserDisplay[];
  currentUser?: User;
  currencyCode?: CurrencyCode;
  canViewProviderInfo?: boolean;
}

export function UserKeyManager({
  users,
  currentUser,
  currencyCode = "USD",
  canViewProviderInfo = true,
}: UserKeyManagerProps) {
  // 普通用户默认选择自己，管理员选择第一个用户
  const getInitialUser = () => {
    if (currentUser?.role === "user") {
      // 普通用户只能看到自己
      return users.find((u) => u.id === currentUser.id) || users[0];
    }
    // 管理员看到第一个用户
    return users[0];
  };

  const [activeUserId, setActiveUserId] = useState<number | null>(getInitialUser()?.id ?? null);
  const activeUser = users.find((u) => u.id === activeUserId) ?? getInitialUser();

  // 普通用户只显示Key列表，不显示用户列表
  if (currentUser?.role === "user") {
    return (
      <div className="space-y-3">
        <div className="bg-card text-card-foreground border border-border rounded-xl p-4">
          <KeyListHeader
            activeUser={activeUser}
            currentUser={currentUser}
            currencyCode={currencyCode}
            canViewProviderInfo={canViewProviderInfo}
          />
          <KeyList
            keys={activeUser?.keys || []}
            currentUser={currentUser}
            keyOwnerUserId={activeUser?.id || 0}
            currencyCode={currencyCode}
          />
        </div>
      </div>
    );
  }

  // 管理员显示完整布局（用户列表 + Key列表）
  return (
    <div className="space-y-3">
      {/* 主从布局 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* 左侧用户列表 */}
        <UserList
          users={users}
          activeUserId={activeUser?.id}
          onUserSelect={setActiveUserId}
          currentUser={currentUser}
        />

        {/* 右侧：当前用户的 Key 列表 */}
        <div className="md:col-span-2 bg-card text-card-foreground border border-border rounded-xl p-4">
          <KeyListHeader
            activeUser={activeUser}
            currentUser={currentUser}
            currencyCode={currencyCode}
            canViewProviderInfo={canViewProviderInfo}
          />
          <KeyList
            keys={activeUser?.keys || []}
            currentUser={currentUser}
            keyOwnerUserId={activeUser?.id || 0}
            currencyCode={currencyCode}
          />
        </div>
      </div>
    </div>
  );
}

// 导出新的统一类型
export type { UserDisplay, UserKeyDisplay } from "@/types/user";
