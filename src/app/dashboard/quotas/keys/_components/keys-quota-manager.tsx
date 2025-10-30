"use client";

import { useState, useMemo } from "react";
import { KeysQuotaClient } from "./keys-quota-client";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface KeyQuota {
  cost5h: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
}

interface KeyWithQuota {
  id: number;
  name: string;
  status: string;
  expiresAt: string | null;
  quota: KeyQuota | null;
}

interface UserWithKeys {
  id: number;
  name: string;
  role: string;
  keys: KeyWithQuota[];
}

interface KeysQuotaManagerProps {
  users: UserWithKeys[];
}

export function KeysQuotaManager({ users }: KeysQuotaManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // 搜索过滤：支持搜索用户名和密钥名
  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;

    const lowerQuery = searchQuery.toLowerCase();
    return users
      .map((user) => {
        // 检查用户名是否匹配
        const userNameMatches = user.name.toLowerCase().includes(lowerQuery);

        // 筛选匹配的密钥
        const matchedKeys = user.keys.filter((key) =>
          key.name.toLowerCase().includes(lowerQuery)
        );

        // 如果用户名匹配，显示所有密钥；否则只显示匹配的密钥
        if (userNameMatches) {
          return user;
        } else if (matchedKeys.length > 0) {
          return { ...user, keys: matchedKeys };
        }
        return null;
      })
      .filter((user): user is UserWithKeys => user !== null);
  }, [users, searchQuery]);

  // 统计信息
  const totalFilteredKeys = filteredUsers.reduce((sum, user) => sum + user.keys.length, 0);

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索用户或密钥..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          显示 {filteredUsers.length} 个用户，{totalFilteredKeys} 个密钥
        </div>
      </div>

      {/* 按用户分组的密钥列表 */}
      <KeysQuotaClient users={filteredUsers} />
    </div>
  );
}
