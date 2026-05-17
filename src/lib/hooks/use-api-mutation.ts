"use client";

import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  getApiErrorMessageKey,
  getApiErrorMessageParams,
  isApiError,
} from "@/lib/api-client/v1/errors";
import { isNetworkError } from "@/lib/utils/error-detection";
import { getErrorMessage } from "@/lib/utils/error-messages";

export function useApiMutation<TData, TVariables>(
  options: UseMutationOptions<TData, unknown, TVariables>
) {
  const tErrors = useTranslations("errors");
  return useMutation({
    ...options,
    onError: (error, variables, context, mutation) => {
      const message = getApiMutationErrorMessage(tErrors, error);
      toast.error(message);
      options.onError?.(error, variables, context, mutation);
    },
  });
}

function getApiMutationErrorMessage(
  tErrors: (key: string, params?: Record<string, string | number>) => string,
  error: unknown
): string {
  if (isApiError(error)) {
    return getErrorMessage(tErrors, getApiErrorMessageKey(error), getApiErrorMessageParams(error));
  }

  if (isNetworkError(error)) {
    return getErrorMessage(tErrors, "NETWORK_ERROR");
  }

  return getErrorMessage(tErrors, "INTERNAL_ERROR");
}
