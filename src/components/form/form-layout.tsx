"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 表单布局配置
 */
export interface FormLayoutConfig {
  title: string;
  description?: string;
  submitText: string;
  cancelText?: string;
  loadingText?: string;
}

/**
 * 表单布局组件属性
 */
export interface FormLayoutProps {
  config: FormLayoutConfig;
  children: ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  canSubmit?: boolean;
  error?: string;
}

/**
 * 通用对话框表单布局
 */
export function DialogFormLayout({
  config,
  children,
  onSubmit,
  onCancel,
  isSubmitting = false,
  canSubmit = true,
  error,
}: FormLayoutProps) {
  const t = useTranslations("forms");
  return (
    <form onSubmit={onSubmit} className="flex flex-col min-h-0 flex-1" noValidate>
      <DialogHeader className="flex-shrink-0">
        <DialogTitle>{config.title}</DialogTitle>
        {config.description && <DialogDescription>{config.description}</DialogDescription>}
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0 py-4 pr-2 -mr-2">
        <div className="grid gap-4">
          {children}

          {error && (
            <div className="text-xs text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="flex-shrink-0 pt-4 border-t">
        <DialogClose asChild>
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {config.cancelText || t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit || isSubmitting} className="min-w-[100px]">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {config.loadingText || t("common.processing")}
            </>
          ) : (
            config.submitText
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 页面级表单布局
 */
export function PageFormLayout({
  config,
  children,
  onSubmit,
  onCancel,
  isSubmitting = false,
  canSubmit = true,
  error,
}: FormLayoutProps) {
  const t = useTranslations("forms");
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">{config.title}</h2>
        {config.description && <p className="text-muted-foreground">{config.description}</p>}
      </div>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="space-y-4">
          {children}

          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              {config.cancelText || t("common.cancel")}
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit || isSubmitting} className="min-w-[120px]">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {config.loadingText || t("common.processing")}
              </>
            ) : (
              config.submitText
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * 表单分组组件
 */
export interface FormGroupProps {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function FormGroup({ title, description, children }: FormGroupProps) {
  return (
    <div className="space-y-4">
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-lg font-medium">{title}</h3>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/**
 * 表单字段网格布局
 */
export interface FormGridProps {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  gap?: 2 | 3 | 4 | 5 | 6 | 8;
}

export function FormGrid({ children, columns = 1, gap = 4 }: FormGridProps) {
  const gridClasses = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  };

  const gapClasses: Record<NonNullable<FormGridProps["gap"]>, string> = {
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
