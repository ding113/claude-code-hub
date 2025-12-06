"use client";
import { useState } from "react";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { User, UserDisplay } from "@/types/user";
import { KeyList } from "./key-list";
import { KeyListHeader } from "./key-list-header";
import { UserList } from "./user-list";

interface UserKeyManagerProps {
  users: UserDisplay[];
  currentUser?: User;
  currencyCode?: CurrencyCode;
}

export function UserKeyManager({ users, currentUser, currencyCode = "USD" }: UserKeyManagerProps) {
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
          />
          <KeyList
            keys={activeUser?.keys || []}
            currentUser={currentUser}
            keyOwnerUserId={activeUser?.id || 0}
            keyOwnerUser={
              activeUser
                ? {
                    id: activeUser.id,
                    name: activeUser.name,
                    description: activeUser.note || "",
                    role: activeUser.role,
                    rpm: activeUser.rpm,
                    dailyQuota: activeUser.dailyQuota,
                    providerGroup: activeUser.providerGroup || null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    limit5hUsd: activeUser.limit5hUsd ?? undefined,
                    limitWeeklyUsd: activeUser.limitWeeklyUsd ?? undefined,
                    limitMonthlyUsd: activeUser.limitMonthlyUsd ?? undefined,
                    limitConcurrentSessions: activeUser.limitConcurrentSessions ?? undefined,
                    isEnabled: activeUser.isEnabled,
                    expiresAt: activeUser.expiresAt ?? undefined,
                  }
                : undefined
            }
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
          />
          <KeyList
            keys={activeUser?.keys || []}
            currentUser={currentUser}
            keyOwnerUserId={activeUser?.id || 0}
            keyOwnerUser={
              activeUser
                ? {
                    id: activeUser.id,
                    name: activeUser.name,
                    description: activeUser.note || "",
                    role: activeUser.role,
                    rpm: activeUser.rpm,
                    dailyQuota: activeUser.dailyQuota,
                    providerGroup: activeUser.providerGroup || null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    limit5hUsd: activeUser.limit5hUsd ?? undefined,
                    limitWeeklyUsd: activeUser.limitWeeklyUsd ?? undefined,
                    limitMonthlyUsd: activeUser.limitMonthlyUsd ?? undefined,
                    limitConcurrentSessions: activeUser.limitConcurrentSessions ?? undefined,
                    isEnabled: activeUser.isEnabled,
                    expiresAt: activeUser.expiresAt ?? undefined,
                  }
                : undefined
            }
            currencyCode={currencyCode}
          />
        </div>
      </div>
    </div>
  );
}

// 导出新的统一类型
export type { UserDisplay, UserKeyDisplay } from "@/types/user";
