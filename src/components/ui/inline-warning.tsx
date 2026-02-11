import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface InlineWarningProps {
  children: ReactNode;
  className?: string;
}

/**
 * 表单字段的内联警告提示组件（仅提示，不阻止提交）。
 */
export function InlineWarning({ children, className }: InlineWarningProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
