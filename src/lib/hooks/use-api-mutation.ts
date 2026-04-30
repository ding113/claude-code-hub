"use client";

import type { QueryKey } from "@tanstack/react-query";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, localizeError } from "@/lib/api-client/v1/client";

/**
 * useApiMutation 选项。
 */
export interface UseApiMutationOptions<TInput, TData> {
  /** 实际的 mutation 函数 */
  mutationFn: (input: TInput) => Promise<TData>;
  /** 成功回调（在缓存失效之后调用） */
  onSuccess?: (data: TData, input: TInput) => void;
  /** 错误回调；提供时会接管默认 toast，传入 false 可静默 */
  onError?: ((error: ApiError | Error, input: TInput) => void) | false;
  /** 成功后需要失效的 query key 列表（前缀匹配） */
  invalidates?: ReadonlyArray<QueryKey>;
}

/** 默认错误处理：localize + sonner toast */
function defaultErrorHandler(err: ApiError | Error): void {
  const message = err instanceof ApiError ? localizeError(err) : err.message;
  toast.error(message || "Unknown error");
}

/**
 * 与 /api/v1 客户端配套的标准化 mutation hook。
 *
 * 行为：
 * - 包装 `useMutation`，泛型签名 `<TInput, TData>`；
 * - `onError` 默认调用 `localizeError` 并通过 sonner toast 通知用户；
 *   传入 `onError: false` 可静默错误，自定义 onError 函数则取代默认行为；
 * - `onSuccess` 在 `invalidates` 失效完成后执行，避免渲染竞争；
 * - 默认不重试（API 错误通常不可恢复，重试由调用方显式开启）。
 *
 * @example
 * ```tsx
 * const { mutateAsync, isPending } = useApiMutation<CreateInput, WebhookTarget>({
 *   mutationFn: (input) => apiClient.webhookTargets.create(input),
 *   invalidates: [v1Keys.all],
 *   onSuccess: () => toast.success("Created"),
 * });
 * ```
 */
export function useApiMutation<TInput, TData>(
  opts: UseApiMutationOptions<TInput, TData>
): UseMutationResult<TData, ApiError | Error, TInput> {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError | Error, TInput>({
    mutationFn: opts.mutationFn,
    retry: false,
    onSuccess: async (data, input) => {
      if (opts.invalidates && opts.invalidates.length > 0) {
        await Promise.all(
          opts.invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
        );
      }
      opts.onSuccess?.(data, input);
    },
    onError: (err, input) => {
      if (opts.onError === false) return;
      if (typeof opts.onError === "function") {
        opts.onError(err, input);
        return;
      }
      defaultErrorHandler(err);
    },
  });
}
