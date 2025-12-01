"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * 表格列定义
 */
export interface TableColumn<T = any> {
  key: string;
  title: string;
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  render?: (value: any, record: T, index: number) => ReactNode;
  className?: string;
}

/**
 * 表格数据结构
 */
export interface TableData {
  id: string | number;
  [key: string]: any;
}

/**
 * 表格组件属性
 */
export interface DataTableProps<T extends TableData> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  error?: string;
  emptyState?: {
    title: string;
    description?: string;
    action?: ReactNode;
  };
  onRowClick?: (record: T, index: number) => void;
  rowClassName?: (record: T, index: number) => string;
  maxHeight?: string;
  stickyHeader?: boolean;
}

/**
 * 通用数据表格组件
 */
export function DataTable<T extends TableData>({
  columns,
  data,
  loading = false,
  error,
  emptyState,
  onRowClick,
  rowClassName,
  maxHeight,
  stickyHeader = false,
}: DataTableProps<T>) {
  const t = useTranslations("ui");
  const renderCell = (column: TableColumn<T>, record: T, index: number) => {
    if (column.render) {
      return column.render(record[column.key], record, index);
    }
    return record[column.key];
  };

  const handleRowClick = (record: T, index: number) => {
    onRowClick?.(record, index);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 space-y-3">
        <div className="text-center">
          {emptyState ? (
            <>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{emptyState.title}</h3>
              {emptyState.description && (
                <p className="text-xs text-muted-foreground mb-3">{emptyState.description}</p>
              )}
              {emptyState.action}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative", maxHeight && "overflow-y-auto")}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Table>
        <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-background")}>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  "whitespace-nowrap",
                  column.align === "center" && "text-center",
                  column.align === "right" && "text-right",
                  column.className
                )}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((record, index) => (
            <TableRow
              key={record.id}
              className={cn(
                onRowClick && "cursor-pointer hover:bg-muted/50",
                rowClassName?.(record, index)
              )}
              onClick={() => handleRowClick(record, index)}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    column.align === "center" && "text-center",
                    column.align === "right" && "text-right",
                    column.className
                  )}
                >
                  {renderCell(column, record, index)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * 表格容器组件
 */
export interface TableContainerProps {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
}

export function TableContainer({ children, title, description, actions }: TableContainerProps) {
  return (
    <div className="space-y-4">
      {(title || actions) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * 预定义的表格列类型
 */
export const TableColumnTypes = {
  /**
   * 文本列
   */
  text: <T extends TableData>(
    key: string,
    title: string,
    options?: Partial<TableColumn<T>>
  ): TableColumn<T> => ({
    key,
    title,
    ...options,
  }),

  /**
   * 数字列
   */
  number: <T extends TableData>(
    key: string,
    title: string,
    options?: Partial<TableColumn<T>>
  ): TableColumn<T> => ({
    key,
    title,
    align: "right",
    ...options,
  }),

  /**
   * 日期列
   */
  date: <T extends TableData>(
    key: string,
    title: string,
    options?: Partial<TableColumn<T>>
  ): TableColumn<T> => ({
    key,
    title,
    render: (value) => {
      if (!value) return "-";
      return new Date(value).toLocaleDateString();
    },
    ...options,
  }),

  /**
   * 状态列
   */
  status: <T extends TableData>(
    key: string,
    title: string,
    statusMap?: Record<string, { text: string; className?: string }>,
    options?: Partial<TableColumn<T>>
  ): TableColumn<T> => ({
    key,
    title,
    render: (value) => {
      const status = statusMap?.[value] || { text: value, className: undefined };
      const s: { text: string; className?: string } = status as any;
      return (
        <span className={cn("inline-block px-2 py-1 rounded-full text-xs", s.className)}>
          {s.text}
        </span>
      );
    },
    ...options,
  }),

  /**
   * 操作列
   */
  actions: <T extends TableData>(
    title: string = "操作",
    render: (value: any, record: T, index: number) => ReactNode,
    options?: Partial<TableColumn<T>>
  ): TableColumn<T> => ({
    key: "actions",
    title,
    width: "auto",
    render,
    ...options,
  }),
};
