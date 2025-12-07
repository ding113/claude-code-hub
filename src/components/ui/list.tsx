"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 列表项数据结构
 */
export interface ListItemData {
  id: string | number;
  title: string;
  subtitle?: string;
  description?: string;
  badge?: {
    text: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
  };
  status?: "active" | "inactive" | "warning" | "error";
  metadata?: Array<{
    label: string;
    value: string;
  }>;
  tags?: string[]; // 标签列表
}

/**
 * 列表项组件属性
 */
export interface ListItemProps {
  data: ListItemData;
  isActive?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  actions?: ReactNode;
  showStatus?: boolean;
  compact?: boolean;
}

/**
 * 通用列表项组件
 */
export function ListItem({
  data,
  isActive = false,
  isSelected = false,
  onClick,
  onDoubleClick,
  actions,
  showStatus = false,
  compact = false,
}: ListItemProps) {
  const statusColors = {
    active: "bg-green-100 border-green-200",
    inactive: "bg-gray-100 border-gray-200",
    warning: "bg-yellow-100 border-yellow-200",
    error: "bg-red-100 border-red-200",
  };

  const handleClick = () => {
    onClick?.();
  };

  const handleDoubleClick = () => {
    onDoubleClick?.();
  };

  return (
    <div
      className={cn(
        "border rounded-lg p-3 transition-colors cursor-pointer",
        "hover:bg-muted/40",
        isActive && "bg-muted/50",
        isSelected && "ring-2 ring-primary ring-offset-2",
        data.status && statusColors[data.status],
        compact && "p-2"
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 主标题 */}
          <div className="flex items-center gap-2">
            <h3 className={cn("font-medium truncate", compact ? "text-sm" : "text-base")}>
              {data.title}
            </h3>

            {/* 状态指示器 */}
            {showStatus && data.status && (
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  data.status === "active" && "bg-green-500",
                  data.status === "inactive" && "bg-gray-400",
                  data.status === "warning" && "bg-yellow-500",
                  data.status === "error" && "bg-red-500"
                )}
              />
            )}
          </div>

          {/* 副标题 */}
          {data.subtitle && (
            <p
              className={cn(
                "text-muted-foreground truncate mt-0.5",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {data.subtitle}
            </p>
          )}

          {/* 描述 */}
          {data.description && !compact && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{data.description}</p>
          )}

          {/* 标签 */}
          {data.tags && data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {data.tags.slice(0, compact ? 3 : 5).map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs px-1.5 py-0 h-5 font-normal"
                >
                  {tag}
                </Badge>
              ))}
              {data.tags.length > (compact ? 3 : 5) && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0 h-5 font-normal text-muted-foreground"
                >
                  +{data.tags.length - (compact ? 3 : 5)}
                </Badge>
              )}
            </div>
          )}

          {/* 元数据 */}
          {data.metadata && data.metadata.length > 0 && (
            <div className={cn("flex flex-wrap gap-2 mt-2", compact && "mt-1")}>
              {data.metadata.map((meta, index) => (
                <span
                  key={index}
                  className={cn(
                    "inline-flex items-center text-xs text-muted-foreground",
                    compact && "text-[11px]"
                  )}
                >
                  <span className="font-medium">{meta.label}:</span>
                  <span className="ml-1">{meta.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 右侧内容 */}
        <div className="flex items-center gap-2">
          {/* 徽章 */}
          {data.badge && <Badge variant={data.badge.variant || "outline"}>{data.badge.text}</Badge>}

          {/* 操作按钮 */}
          {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * 列表容器属性
 */
export interface ListContainerProps {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string;
  emptyState?: {
    title: string;
    description?: string;
    action?: ReactNode;
  };
  maxHeight?: string;
}

/**
 * 通用列表容器组件
 */
export function ListContainer({
  children,
  title,
  description,
  actions,
  loading = false,
  error,
  emptyState,
  maxHeight = "520px",
}: ListContainerProps) {
  const t = useTranslations("ui");
  return (
    <div className="space-y-3">
      {/* 标题和操作 */}
      {(title || actions) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}

      {/* 内容区域 */}
      <div className="space-y-2 overflow-auto pr-1" style={{ maxHeight }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p>{error}</p>
          </div>
        ) : children ? (
          children
        ) : emptyState ? (
          <div className="text-center py-8 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">{emptyState.title}</h3>
            {emptyState.description && (
              <p className="text-xs text-muted-foreground">{emptyState.description}</p>
            )}
            {emptyState.action}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">{t("common.noData")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 网格布局列表
 */
export interface GridListProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: 2 | 3 | 4 | 5 | 6 | 8;
}

export function GridList({ children, columns = 1, gap = 4 }: GridListProps) {
  const gridClasses = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  };
  const gapClasses: Record<NonNullable<GridListProps["gap"]>, string> = {
    2: "gap-2",
    3: "gap-3",
    4: "gap-4",
    5: "gap-5",
    6: "gap-6",
    8: "gap-8",
  };

  return (
    <div className={`grid ${gridClasses[columns]} ${gapClasses[gap] || "gap-4"}`}>{children}</div>
  );
}
