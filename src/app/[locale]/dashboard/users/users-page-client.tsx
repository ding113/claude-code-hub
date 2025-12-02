"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User, UserDisplay } from "@/types/user";
import { UserKeyManager } from "../_components/user/user-key-manager";

interface UsersPageClientProps {
  users: UserDisplay[];
  currentUser: User;
}

export function UsersPageClient({ users, currentUser }: UsersPageClientProps) {
  const t = useTranslations("dashboard.users");
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");

  // Extract unique groups from users (split comma-separated values)
  const uniqueGroups = useMemo(() => {
    const allTags = users
      .map((u) => u.providerGroup)
      .filter((group): group is string => Boolean(group))
      .flatMap((group) =>
        group
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      );
    return [...new Set(allTags)].sort();
  }, [users]);

  // Extract unique tags from users
  const uniqueTags = useMemo(() => {
    const tags = users.flatMap((u) => u.tags || []);
    return [...new Set(tags)].sort();
  }, [users]);

  // Filter users based on search term, group filter, and tag filter
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      // Search filter: match username or tag
      const matchesSearch =
        searchTerm === "" ||
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.tags || []).some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));

      // Group filter (supports comma-separated providerGroup values)
      const matchesGroup =
        groupFilter === "all" ||
        (user.providerGroup
          ?.split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .includes(groupFilter) ??
          false);

      // Tag filter
      const matchesTag = tagFilter === "all" || (user.tags || []).includes(tagFilter);

      return matchesSearch && matchesGroup && matchesTag;
    });
  }, [users, searchTerm, groupFilter, tagFilter]);

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

        {/* Tag filter */}
        {uniqueTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("toolbar.tagFilter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("toolbar.allTags")}</SelectItem>
              {uniqueTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  <Badge variant="secondary" className="mr-1 text-xs">
                    {tag}
                  </Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* User Key Manager with filtered users */}
      <UserKeyManager users={filteredUsers} currentUser={currentUser} currencyCode="USD" />
    </div>
  );
}
