"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * 文档目录项
 */
export interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocNavProps {
  tocItems: TocItem[];
  activeId: string;
  tocReady: boolean;
  onItemClick: (id: string) => void;
}

/**
 * 目录导航组件
 * 支持桌面端和移动端复用
 */
export function TocNav({ tocItems, activeId, tocReady, onItemClick }: TocNavProps) {
  return (
    <nav aria-label="文档目录" className="space-y-1">
      {!tocReady && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      )}
      {tocReady && tocItems.length === 0 && (
        <p className="text-xs text-muted-foreground">本页暂无可用章节</p>
      )}
      {tocReady &&
        tocItems.length > 0 &&
        tocItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onItemClick(item.id)}
            className={cn(
              "block w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              item.level === 3 && "pl-6 text-xs",
              activeId === item.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            aria-current={activeId === item.id ? "location" : undefined}
          >
            {item.text}
          </button>
        ))}
    </nav>
  );
}
