"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/actions/types";
import { isNetworkError } from "@/lib/utils/error-detection";

/**
 * Server Action 执行选项
 */
export interface ExecuteOptions<T> {
  /** 成功时显示的消息 */
  successMessage?: string;
  /** 失败时显示的消息（优先于 Action 返回的 error） */
  errorMessage?: string;
  /** 网络错误时显示的消息 */
  networkErrorMessage?: string;
  /** 成功回调 */
  onSuccess?: (data: T) => void;
  /** 失败回调（包括 Action 返回 ok:false 和网络错误） */
  onError?: (error: string) => void;
  /** 是否显示 toast（默认 true） */
  showToast?: boolean;
}

/**
 * Server Action 执行结果
 */
export type ExecuteResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Default fallback messages (caller should provide i18n messages)
const DEFAULT_NETWORK_ERROR = "Network connection failed";
const DEFAULT_ERROR = "Operation failed";

/**
 * 统一的 Server Action 执行 Hook
 *
 * 功能：
 * - 自动管理 loading 状态
 * - 捕获网络错误（Failed to fetch）并转为友好提示
 * - 统一 toast 通知
 * - 安全：不会将原始错误消息暴露给用户
 *
 * @example
 * ```tsx
 * const { execute, isPending } = useServerAction();
 *
 * const handleSubmit = async (data: FormData) => {
 *   const result = await execute(
 *     () => createUser(data),
 *     {
 *       successMessage: t("createSuccess"),
 *       errorMessage: t("createFailed"),
 *       onSuccess: (user) => router.refresh(),
 *     }
 *   );
 *
 *   if (result.ok) {
 *     // 额外的成功处理
 *   }
 * };
 * ```
 */
export function useServerAction() {
  const [isPending, startTransition] = useTransition();
  const [isExecuting, setIsExecuting] = useState(false);

  const execute = useCallback(
    async <T>(
      action: () => Promise<ActionResult<T>>,
      options: ExecuteOptions<T> = {}
    ): Promise<ExecuteResult<T>> => {
      const {
        successMessage,
        errorMessage,
        networkErrorMessage,
        onSuccess,
        onError,
        showToast = true,
      } = options;

      return new Promise((resolve) => {
        startTransition(async () => {
          setIsExecuting(true);

          try {
            const result = await action();

            if (!result.ok) {
              // Action 返回失败
              const message = errorMessage || result.error;

              if (showToast) {
                toast.error(message);
              }

              onError?.(message);
              resolve({ ok: false, error: message });
              return;
            }

            // Action 成功
            if (showToast && successMessage) {
              toast.success(successMessage);
            }

            onSuccess?.(result.data as T);
            resolve({ ok: true, data: result.data as T });
          } catch (error) {
            // 捕获网络错误或其他异常
            // Security: Never expose raw error.message to users
            const message = isNetworkError(error)
              ? networkErrorMessage || DEFAULT_NETWORK_ERROR
              : errorMessage || DEFAULT_ERROR;

            console.error("[useServerAction] Error:", error);

            if (showToast) {
              toast.error(message);
            }

            onError?.(message);
            resolve({ ok: false, error: message });
          } finally {
            setIsExecuting(false);
          }
        });
      });
    },
    []
  );

  return {
    execute,
    /** 是否正在执行（包括 transition pending 和实际执行中） */
    isPending: isPending || isExecuting,
  };
}

/**
 * 简单的错误处理包装器（不使用 Hook）
 *
 * 适用于不需要 loading 状态的场景
 *
 * @example
 * ```tsx
 * const handleClick = async () => {
 *   const result = await withErrorHandling(
 *     () => deleteItem(id),
 *     { errorMessage: "Failed to delete" }
 *   );
 *
 *   if (result.ok) {
 *     router.refresh();
 *   }
 * };
 * ```
 */
export async function withErrorHandling<T>(
  action: () => Promise<ActionResult<T>>,
  options: Omit<ExecuteOptions<T>, "onSuccess" | "onError"> = {}
): Promise<ExecuteResult<T>> {
  const { successMessage, errorMessage, networkErrorMessage, showToast = true } = options;

  try {
    const result = await action();

    if (!result.ok) {
      const message = errorMessage || result.error;

      if (showToast) {
        toast.error(message);
      }

      return { ok: false, error: message };
    }

    if (showToast && successMessage) {
      toast.success(successMessage);
    }

    return { ok: true, data: result.data as T };
  } catch (error) {
    // Security: Never expose raw error.message to users
    const message = isNetworkError(error)
      ? networkErrorMessage || DEFAULT_NETWORK_ERROR
      : errorMessage || DEFAULT_ERROR;

    console.error("[withErrorHandling] Error:", error);

    if (showToast) {
      toast.error(message);
    }

    return { ok: false, error: message };
  }
}
