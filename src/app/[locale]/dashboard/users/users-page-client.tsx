"use client";

import { useState, useMemo } from "react";
import { UserKeyManager } from "../_components/user/user-key-manager";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UserDisplay, User } from "@/types/user";

interface UsersPageClientProps {
  users: UserDisplay[];
  currentUser: User;
}

export function UsersPageClient({ users, currentUser }: UsersPageClientProps) {
  const t = useTranslations("dashboard.users");
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

  // Extract unique groups from users
  const uniqueGroups = useMemo(() => {
    const groups = users
      .map((u) => u.providerGroup)
      .filter((group): group is string => Boolean(group));
    return [...new Set(groups)];
  }, [users]);

  // Filter users based on search term and group filter
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      // Search filter: match username
      const matchesSearch =
        searchTerm === "" || user.name.toLowerCase().includes(searchTerm.toLowerCase());

      // Group filter
      const matchesGroup = groupFilter === "all" || user.providerGroup === groupFilter;

      return matchesSearch && matchesGroup;
    });
  }, [users, searchTerm, groupFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("description", { count: filteredUsers.length })}
          </p>
        </div>
      </div>

      {/* Toolbar with search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Search input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("toolbar.searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Group filter */}
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("toolbar.groupFilter")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("toolbar.allGroups")}</SelectItem>
            {uniqueGroups.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* User Key Manager with filtered users */}
      <UserKeyManager
        users={filteredUsers}
        currentUser={currentUser}
        currencyCode="USD"
      />
    </div>
  );
}
