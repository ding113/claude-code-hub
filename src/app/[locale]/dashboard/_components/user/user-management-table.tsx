"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { renewUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { User, UserDisplay } from "@/types/user";
import { QuickRenewDialog, type QuickRenewUser } from "./forms/quick-renew-dialog";
import { UnifiedEditDialog } from "./unified-edit-dialog";
import { UserKeyTableRow } from "./user-key-table-row";

export interface UserManagementTableProps {
  users: UserDisplay[];
  currentUser?: User;
  currencyCode?: string;
  onCreateUser?: () => void;
  highlightKeyIds?: Set<number>;
  autoExpandOnFilter?: boolean;
  translations: {
    table: {
      columns: {
        username: string;
        note: string;
        expiresAt: string;
        expiresAtHint?: string;
        limit5h: string;
        limitDaily: string;
        limitWeekly: string;
        limitMonthly: string;
        limitTotal: string;
        limitSessions: string;
      };
      keyRow: any;
      expand: string;
      collapse: string;
      noKeys: string;
      defaultGroup: string;
    };
    editDialog: any;
    actions: {
      edit: string;
      details: string;
      logs: string;
      delete: string;
    };
    pagination: {
      previous: string;
      next: string;
      page: string;
      of: string;
    };
    quickRenew?: {
      title: string;
      description: string;
      currentExpiry: string;
      neverExpires: string;
      expired: string;
      quickOptions: {
        "7days": string;
        "30days": string;
        "90days": string;
        "1year": string;
      };
      customDate: string;
      enableOnRenew: string;
      cancel: string;
      confirm: string;
      confirming: string;
      success: string;
      failed: string;
    };
  };
}

const PAGE_SIZE = 20;
const TOTAL_COLUMNS = 9;

function hasTemplateTokens(text: string) {
  return /\{[a-zA-Z0-9_]+\}/.test(text);
}

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (key in values) return String(values[key]);
    return match;
  });
}

export function UserManagementTable({
  users,
  currentUser,
  currencyCode,
  onCreateUser,
  highlightKeyIds,
  autoExpandOnFilter,
  translations,
}: UserManagementTableProps) {
  const router = useRouter();
  const tUserList = useTranslations("dashboard.userList");
  const tUserMgmt = useTranslations("dashboard.userManagement");
  const isAdmin = currentUser?.role === "admin";
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedUsers, setExpandedUsers] = useState<Map<number, boolean>>(
    () => new Map(users.map((user) => [user.id, false]))
  );
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [scrollToKeyId, setScrollToKeyId] = useState<number | undefined>(undefined);

  // Quick renew dialog state
  const [quickRenewOpen, setQuickRenewOpen] = useState(false);
  const [quickRenewUser, setQuickRenewUser] = useState<QuickRenewUser | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(users.length / PAGE_SIZE)),
    [users.length]
  );

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(prev, 1), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setExpandedUsers((prev) => {
      const next = new Map<number, boolean>();
      for (const user of users) {
        next.set(user.id, prev.get(user.id) ?? false);
      }

      if (next.size !== prev.size) return next;
      for (const [userId, expanded] of next) {
        if (prev.get(userId) !== expanded) return next;
      }
      return prev;
    });
  }, [users]);

  useEffect(() => {
    if (autoExpandOnFilter) {
      setExpandedUsers(new Map(users.map((user) => [user.id, true])));
    }
  }, [autoExpandOnFilter, users]);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return users.slice(start, start + PAGE_SIZE);
  }, [users, currentPage]);

  const allExpanded = useMemo(() => {
    if (users.length === 0) return false;
    return users.every((user) => expandedUsers.get(user.id) ?? false);
  }, [users, expandedUsers]);

  const paginationText = useMemo(() => {
    const templateMode =
      hasTemplateTokens(translations.pagination.page) ||
      hasTemplateTokens(translations.pagination.of);

    if (templateMode) {
      const pageText = formatTemplate(translations.pagination.page, {
        page: currentPage,
        current: currentPage,
        currentPage,
        totalPages,
        total: totalPages,
      });
      const ofText = formatTemplate(translations.pagination.of, {
        page: currentPage,
        current: currentPage,
        currentPage,
        totalPages,
        total: totalPages,
      });
      return `${pageText} / ${ofText}`;
    }

    return `${translations.pagination.page} ${currentPage} / ${translations.pagination.of} ${totalPages}`;
  }, [currentPage, totalPages, translations.pagination]);

  const rowTranslations = useMemo(() => {
    return {
      columns: {
        ...translations.table.columns,
        expiresAtHint: isAdmin
          ? translations.table.columns.expiresAtHint || tUserMgmt("table.columns.expiresAtHint")
          : undefined,
      },
      keyRow: translations.table.keyRow,
      expand: translations.table.expand,
      collapse: translations.table.collapse,
      noKeys: translations.table.noKeys,
      defaultGroup: translations.table.defaultGroup,
      actions: translations.actions,
      userStatus: {
        disabled: tUserMgmt("keyStatus.disabled"),
      },
    };
  }, [translations, isAdmin, tUserMgmt]);

  const quickRenewTranslations = useMemo(() => {
    if (translations.quickRenew) return translations.quickRenew;
    // Fallback to translation keys
    return {
      title: tUserMgmt("quickRenew.title"),
      description: tUserMgmt("quickRenew.description"),
      currentExpiry: tUserMgmt("quickRenew.currentExpiry"),
      neverExpires: tUserMgmt("quickRenew.neverExpires"),
      expired: tUserMgmt("quickRenew.expired"),
      quickOptions: {
        "7days": tUserMgmt("quickRenew.quickOptions.7days"),
        "30days": tUserMgmt("quickRenew.quickOptions.30days"),
        "90days": tUserMgmt("quickRenew.quickOptions.90days"),
        "1year": tUserMgmt("quickRenew.quickOptions.1year"),
      },
      customDate: tUserMgmt("quickRenew.customDate"),
      enableOnRenew: tUserMgmt("quickRenew.enableOnRenew"),
      cancel: tUserMgmt("quickRenew.cancel"),
      confirm: tUserMgmt("quickRenew.confirm"),
      confirming: tUserMgmt("quickRenew.confirming"),
    };
  }, [translations.quickRenew, tUserMgmt]);

  const editingUser = useMemo(() => {
    if (!editingUserId) return null;
    return users.find((u) => u.id === editingUserId) ?? null;
  }, [users, editingUserId]);

  useEffect(() => {
    if (!editDialogOpen) return;
    if (!editingUser) {
      setEditDialogOpen(false);
      setEditingUserId(null);
      setScrollToKeyId(undefined);
    }
  }, [editDialogOpen, editingUser]);

  const handleToggleUser = (userId: number) => {
    setExpandedUsers((prev) => {
      const next = new Map(prev);
      next.set(userId, !(prev.get(userId) ?? false));
      return next;
    });
  };

  const handleToggleAll = () => {
    const nextExpanded = !allExpanded;
    setExpandedUsers(new Map(users.map((user) => [user.id, nextExpanded])));
  };

  const openEditDialog = (userId: number, keyId?: number) => {
    setEditingUserId(userId);
    setScrollToKeyId(keyId);
    setEditDialogOpen(true);
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (open) return;
    setEditingUserId(null);
    setScrollToKeyId(undefined);
  };

  // Quick renew handlers
  const handleOpenQuickRenew = (user: UserDisplay) => {
    setQuickRenewUser({
      id: user.id,
      name: user.name,
      expiresAt: user.expiresAt ?? null,
      isEnabled: user.isEnabled,
    });
    setQuickRenewOpen(true);
  };

  const handleQuickRenewConfirm = async (
    userId: number,
    expiresAt: Date,
    enableUser?: boolean
  ): Promise<{ ok: boolean }> => {
    try {
      const res = await renewUser(userId, { expiresAt: expiresAt.toISOString(), enableUser });
      if (!res.ok) {
        toast.error(res.error || tUserMgmt("quickRenew.failed"));
        return { ok: false };
      }
      toast.success(tUserMgmt("quickRenew.success"));
      router.refresh();
      return { ok: true };
    } catch (error) {
      console.error("[QuickRenew] failed", error);
      toast.error(tUserMgmt("quickRenew.failed"));
      return { ok: false };
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleToggleAll}
          disabled={users.length === 0}
        >
          {allExpanded ? translations.table.collapse : translations.table.expand}
        </Button>
      </div>

      <div className={cn("border border-border rounded-lg", "overflow-hidden")}>
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">
                {translations.table.columns.username} / {translations.table.columns.note}
              </TableHead>
              <TableHead>{translations.table.columns.expiresAt}</TableHead>
              <TableHead className="text-center">{translations.table.columns.limit5h}</TableHead>
              <TableHead className="text-center">{translations.table.columns.limitDaily}</TableHead>
              <TableHead className="text-center">
                {translations.table.columns.limitWeekly}
              </TableHead>
              <TableHead className="text-center">
                {translations.table.columns.limitMonthly}
              </TableHead>
              <TableHead className="text-center">{translations.table.columns.limitTotal}</TableHead>
              <TableHead className="text-center">
                {translations.table.columns.limitSessions}
              </TableHead>
              <TableHead className="text-center">{translations.actions.edit}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {paginatedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={TOTAL_COLUMNS} className="py-16">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="mb-4 rounded-full bg-muted p-3">
                      <Users className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium">{tUserList("emptyState.title")}</h3>
                    <p className="mb-4 max-w-sm text-sm text-muted-foreground">
                      {tUserList("emptyState.description")}
                    </p>
                    {onCreateUser && (
                      <Button onClick={onCreateUser}>{tUserList("emptyState.action")}</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedUsers.map((user) => (
                <UserKeyTableRow
                  key={user.id}
                  user={user}
                  expanded={expandedUsers.get(user.id) ?? false}
                  onToggle={() => handleToggleUser(user.id)}
                  onEditUser={(keyId) => openEditDialog(user.id, keyId)}
                  onQuickRenew={isAdmin ? handleOpenQuickRenew : undefined}
                  currentUser={currentUser}
                  currencyCode={currencyCode}
                  translations={rowTranslations}
                  highlightKeyIds={highlightKeyIds}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination moved to bottom */}
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={users.length === 0 || currentPage <= 1}
        >
          {translations.pagination.previous}
        </Button>
        <span className="text-sm text-muted-foreground">{paginationText}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={users.length === 0 || currentPage >= totalPages}
        >
          {translations.pagination.next}
        </Button>
      </div>

      {editingUser ? (
        <UnifiedEditDialog
          open={editDialogOpen}
          onOpenChange={handleEditDialogOpenChange}
          mode="edit"
          user={editingUser}
          scrollToKeyId={scrollToKeyId}
          currentUser={currentUser}
        />
      ) : null}

      {/* Quick renew dialog */}
      <QuickRenewDialog
        open={quickRenewOpen}
        onOpenChange={setQuickRenewOpen}
        user={quickRenewUser}
        onConfirm={handleQuickRenewConfirm}
        translations={quickRenewTranslations}
      />
    </div>
  );
}
