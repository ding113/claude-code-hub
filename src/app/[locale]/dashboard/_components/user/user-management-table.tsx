"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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
  const tUserList = useTranslations("dashboard.userList");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedUsers, setExpandedUsers] = useState<Map<number, boolean>>(
    () => new Map(users.map((user) => [user.id, true]))
  );
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [scrollToKeyId, setScrollToKeyId] = useState<number | undefined>(undefined);

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
        next.set(user.id, prev.get(user.id) ?? true);
      }

      if (next.size !== prev.size) return next;
      for (const [userId, expanded] of next) {
        if (prev.get(userId) !== expanded) return next;
      }
      return prev;
    });
  }, [users]);

  // Auto-expand all users when filter is active
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
    if (users.length === 0) return true;
    return users.every((user) => expandedUsers.get(user.id) ?? true);
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
      columns: translations.table.columns,
      keyRow: translations.table.keyRow,
      expand: translations.table.expand,
      collapse: translations.table.collapse,
      noKeys: translations.table.noKeys,
      defaultGroup: translations.table.defaultGroup,
      actions: translations.actions,
    };
  }, [translations]);

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
      next.set(userId, !(prev.get(userId) ?? true));
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleToggleAll}
          disabled={users.length === 0}
        >
          {allExpanded ? translations.table.collapse : translations.table.expand}
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{paginationText}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={users.length === 0 || currentPage <= 1}
          >
            {translations.pagination.previous}
          </Button>
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
                  expanded={expandedUsers.get(user.id) ?? true}
                  onToggle={() => handleToggleUser(user.id)}
                  onEditUser={(keyId) => openEditDialog(user.id, keyId)}
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
    </div>
  );
}
