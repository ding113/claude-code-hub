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

/**
 * Split comma-separated tags into an array of trimmed, non-empty strings.
 * This matches the server-side providerGroup handling in provider-selector.ts
 */
function splitTags(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

interface UsersPageClientProps {
  users: UserDisplay[];
  currentUser: User;
}

export function UsersPageClient({ users, currentUser }: UsersPageClientProps) {
  const t = useTranslations("dashboard.users");
  const tUiTable = useTranslations("ui.table");
  const tUserMgmt = useTranslations("dashboard.userManagement");
  const tKeyList = useTranslations("dashboard.keyList");
  const tCommon = useTranslations("common");
  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [keyGroupFilter, setKeyGroupFilter] = useState("all");

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

  // Extract unique tags from users
  const uniqueTags = useMemo(() => {
    const tags = users.flatMap((u) => u.tags || []);
    return [...new Set(tags)].sort();
  }, [users]);

  // Extract unique key groups from users (split comma-separated tags)
  const uniqueKeyGroups = useMemo(() => {
    const groups = users.flatMap((u) => u.keys?.flatMap((k) => splitTags(k.providerGroup)) || []);
    return [...new Set(groups)].sort();
  }, [users]);

  // Reset filter if selected value no longer exists in options
  useEffect(() => {
    if (tagFilter !== "all" && !uniqueTags.includes(tagFilter)) {
      setTagFilter("all");
    }
  }, [uniqueTags, tagFilter]);

  useEffect(() => {
    if (keyGroupFilter !== "all" && !uniqueKeyGroups.includes(keyGroupFilter)) {
      setKeyGroupFilter("all");
    }
  }, [uniqueKeyGroups, keyGroupFilter]);

  // Filter users based on search term, tag filter, and key group filter
  const { filteredUsers, matchingKeyIds } = useMemo(() => {
    const matchingIds = new Set<number>();
    const normalizedTerm = searchTerm.trim().toLowerCase();
    const hasSearch = normalizedTerm.length > 0;

    const filtered: UserDisplay[] = [];

    for (const user of users) {
      // Collect matching key IDs for this user (before filtering)
      const userMatchingKeyIds: number[] = [];

      // Search filter: match user-level fields or any key fields
      let matchesSearch = !hasSearch;

      if (hasSearch) {
        // User-level fields: name, note, tags, providerGroup
        const userMatches =
          user.name.toLowerCase().includes(normalizedTerm) ||
          (user.note || "").toLowerCase().includes(normalizedTerm) ||
          (user.tags || []).some((tag) => tag.toLowerCase().includes(normalizedTerm)) ||
          (user.providerGroup || "").toLowerCase().includes(normalizedTerm);

        if (userMatches) {
          matchesSearch = true;
        } else if (user.keys) {
          // Key-level fields: name, maskedKey, fullKey, providerGroup
          for (const key of user.keys) {
            const keyMatches =
              key.name.toLowerCase().includes(normalizedTerm) ||
              key.maskedKey.toLowerCase().includes(normalizedTerm) ||
              (key.fullKey || "").toLowerCase().includes(normalizedTerm) ||
              (key.providerGroup || "").toLowerCase().includes(normalizedTerm);

            if (keyMatches) {
              matchesSearch = true;
              userMatchingKeyIds.push(key.id);
              // Don't break - collect all matching keys
            }
          }
        }
      }

      // Tag filter
      const matchesTag = tagFilter === "all" || (user.tags || []).includes(tagFilter);

      // Key group filter (check if any split tag matches the filter)
      let matchesKeyGroup = keyGroupFilter === "all";
      if (keyGroupFilter !== "all" && user.keys) {
        for (const key of user.keys) {
          if (splitTags(key.providerGroup).includes(keyGroupFilter)) {
            matchesKeyGroup = true;
            userMatchingKeyIds.push(key.id);
          }
        }
      }

      // Only add to results and matchingIds if user passes ALL filters
      if (matchesSearch && matchesTag && matchesKeyGroup) {
        filtered.push(user);
        // Add matching key IDs only for users that pass the filter
        for (const keyId of userMatchingKeyIds) {
          matchingIds.add(keyId);
        }
      }
    }

    return { filteredUsers: filtered, matchingKeyIds: matchingIds };
  }, [users, searchTerm, tagFilter, keyGroupFilter]);

  // Determine if we should highlight keys (either search or keyGroup filter is active)
  const shouldHighlightKeys = searchTerm.trim().length > 0 || keyGroupFilter !== "all";

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

        {/* Key group filter */}
        {uniqueKeyGroups.length > 0 && (
          <Select value={keyGroupFilter} onValueChange={setKeyGroupFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("toolbar.keyGroupFilter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("toolbar.allKeyGroups")}</SelectItem>
              {uniqueKeyGroups.map((group) => (
                <SelectItem key={group} value={group}>
                  <Badge variant="outline" className="mr-1 text-xs">
                    {group}
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
        highlightKeyIds={shouldHighlightKeys ? matchingKeyIds : undefined}
        autoExpandOnFilter={shouldHighlightKeys}
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
                callsLabel: tUserMgmt("table.keyRow.fields.callsLabel"),
                costLabel: tUserMgmt("table.keyRow.fields.costLabel"),
              },
              actions: {
                details: tKeyList("detailsButton"),
                logs: tKeyList("logsButton"),
                edit: tCommon("edit"),
                delete: tCommon("delete"),
                copy: tCommon("copy"),
                copySuccess: tCommon("copySuccess"),
                copyFailed: tCommon("copyFailed"),
                show: tKeyList("showKeyTooltip"),
                hide: tKeyList("hideKeyTooltip"),
              },
              status: {
                enabled: tUserMgmt("keyStatus.enabled"),
                disabled: tUserMgmt("keyStatus.disabled"),
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
