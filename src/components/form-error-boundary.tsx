"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";

/**
 * 表单专用错误边界 - 用于对话框内表单的错误处理
 */
export function FormErrorBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations("forms");
  const tu = useTranslations("ui");
  return (
    <ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="p-2">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{t("errors.formErrorTitle")}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {error?.message || t("errors.formErrorDescription")}
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={resetError}>
              <RefreshCw className="w-3 h-3 mr-1" /> {tu("common.retry")}
            </Button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
