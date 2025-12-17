"use client";

import { Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User, UserDisplay } from "@/types/user";
import { UnifiedEditDialog } from "../_components/user/unified-edit-dialog";
import { UserManagementTable } from "../_components/user/user-management-table";
import { UserOnboardingTour } from "../_components/user/user-onboarding-tour";

const ONBOARDING_KEY = "cch-users-onboarding-seen";

interface UsersPageClientProps {
  users: UserDisplay[];
  currentUser: User;
}

export function UsersPageClient({ users, currentUser }: UsersPageClientProps) {
  const t = useTranslations("dashboard.users");
  const tUiTable = useTranslations("ui.table");
  const tUserMgmt = useTranslations("dashboard.userManagement");
  const tKeyList = useTranslations("dashboard.keyList");
  const tUserList = useTranslations("dashboard.userList");
  const tCommon = useTranslations("common");
  const [searchTerm, setSearchTerm] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");

  // Onboarding and create dialog state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(true);

  // Check localStorage for onboarding status on mount
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const seen = localStorage.getItem(ONBOARDING_KEY);
        setHasSeenOnboarding(seen === "true");
      }
    } catch {
      // localStorage not available (e.g., privacy mode)
      setHasSeenOnboarding(true);
    }
  }, []);

  const handleCreateUser = useCallback(() => {
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    } else {
      setShowCreateDialog(true);
    }
  }, [hasSeenOnboarding]);

  const handleOnboardingComplete = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(ONBOARDING_KEY, "true");
      }
    } catch {
      // localStorage not available
    }
    setHasSeenOnboarding(true);
    setShowCreateDialog(true);
  }, []);

  const handleCreateDialogClose = useCallback((open: boolean) => {
    setShowCreateDialog(open);
  }, []);

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
        <Button onClick={handleCreateUser}>
          <Plus className="mr-2 h-4 w-4" />
          {t("toolbar.createUser")}
        </Button>
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

      <UserManagementTable
        users={filteredUsers}
        currentUser={currentUser}
        currencyCode="USD"
        onCreateUser={handleCreateUser}
        translations={{
          table: {
            columns: {
              username: tUserMgmt("table.columns.username"),
              note: tUserMgmt("table.columns.note"),
              expiresAt: tUserMgmt("table.columns.expiresAt"),
              limit5h: tUserMgmt("table.columns.limit5h"),
              limitDaily: tUserMgmt("table.columns.limitDaily"),
              limitWeekly: tUserMgmt("table.columns.limitWeekly"),
              limitMonthly: tUserMgmt("table.columns.limitMonthly"),
              limitTotal: tUserMgmt("table.columns.limitTotal"),
              limitSessions: tUserMgmt("table.columns.limitSessions"),
            },
            keyRow: {
              fields: {
                name: tUserMgmt("table.keyRow.name"),
                key: tUserMgmt("table.keyRow.key"),
                group: tUserMgmt("table.keyRow.group"),
                todayUsage: tUserMgmt("table.keyRow.todayUsage"),
                todayCost: tUserMgmt("table.keyRow.todayCost"),
                lastUsed: tUserMgmt("table.keyRow.lastUsed"),
                actions: tUserMgmt("table.keyRow.actions"),
              },
              actions: {
                details: tKeyList("detailsButton"),
                logs: tKeyList("logsButton"),
                edit: tCommon("edit"),
                delete: tCommon("delete"),
                copy: tCommon("copy"),
                show: tKeyList("showKeyTooltip"),
                hide: tKeyList("hideKeyTooltip"),
              },
              status: {
                enabled: tUserList("status.active"),
                disabled: tUserList("status.disabled"),
              },
            },
            expand: tUserMgmt("table.expand"),
            collapse: tUserMgmt("table.collapse"),
            noKeys: tUserMgmt("table.noKeys"),
            defaultGroup: tUserMgmt("table.defaultGroup"),
          },
          editDialog: {},
          actions: {
            edit: tCommon("edit"),
            details: tKeyList("detailsButton"),
            logs: tKeyList("logsButton"),
            delete: tCommon("delete"),
          },
          pagination: {
            previous: tUiTable("previousPage"),
            next: tUiTable("nextPage"),
            page: "Page {page}",
            of: "{totalPages}",
          },
        }}
      />

      {/* Onboarding Tour */}
      <UserOnboardingTour
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onComplete={handleOnboardingComplete}
      />

      {/* Create User Dialog */}
      <UnifiedEditDialog
        open={showCreateDialog}
        onOpenChange={handleCreateDialogClose}
        mode="create"
        currentUser={currentUser}
      />
    </div>
  );
}
