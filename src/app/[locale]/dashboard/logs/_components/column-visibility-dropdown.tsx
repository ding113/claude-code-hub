"use client";

import { Columns3, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_VISIBLE_COLUMNS,
  getHiddenColumns,
  type LogsTableColumn,
  setHiddenColumns,
} from "@/lib/column-visibility";

interface ColumnVisibilityDropdownProps {
  userId: number;
  tableId: string;
  onVisibilityChange?: (hiddenColumns: LogsTableColumn[]) => void;
}

// Column label keys for i18n
const COLUMN_LABEL_KEYS: Record<LogsTableColumn, string> = {
  user: "logs.columns.user",
  key: "logs.columns.key",
  sessionId: "logs.columns.sessionId",
  provider: "logs.columns.provider",
  tokens: "logs.columns.tokens",
  cache: "logs.columns.cache",
  performance: "logs.columns.performance",
};

export function ColumnVisibilityDropdown({
  userId,
  tableId,
  onVisibilityChange,
}: ColumnVisibilityDropdownProps) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [hiddenColumns, setHiddenColumnsState] = useState<LogsTableColumn[]>([]);

  // Load initial state from localStorage
  useEffect(() => {
    const stored = getHiddenColumns(userId, tableId);
    setHiddenColumnsState(stored);
  }, [userId, tableId]);

  const handleToggle = useCallback(
    (column: LogsTableColumn) => {
      const isHidden = hiddenColumns.includes(column);
      const newHidden = isHidden
        ? hiddenColumns.filter((c) => c !== column)
        : [...hiddenColumns, column];

      setHiddenColumnsState(newHidden);
      setHiddenColumns(userId, tableId, newHidden);
      onVisibilityChange?.(newHidden);
    },
    [hiddenColumns, userId, tableId, onVisibilityChange]
  );

  const handleReset = useCallback(() => {
    setHiddenColumnsState([]);
    setHiddenColumns(userId, tableId, []);
    onVisibilityChange?.([]);
  }, [userId, tableId, onVisibilityChange]);

  const visibleCount = DEFAULT_VISIBLE_COLUMNS.length - hiddenColumns.length;
  const totalCount = DEFAULT_VISIBLE_COLUMNS.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <Columns3 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {visibleCount}/{totalCount}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-medium">
          {t("logs.table.columnVisibility")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEFAULT_VISIBLE_COLUMNS.map((column) => {
          const isVisible = !hiddenColumns.includes(column);
          return (
            <DropdownMenuItem
              key={column}
              className="flex items-center gap-2 cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                handleToggle(column);
              }}
            >
              <Checkbox checked={isVisible} className="pointer-events-none" aria-hidden="true" />
              <span className="text-sm">{t(COLUMN_LABEL_KEYS[column])}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-muted-foreground"
          onSelect={(e) => {
            e.preventDefault();
            handleReset();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="text-sm">{tCommon("reset")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
