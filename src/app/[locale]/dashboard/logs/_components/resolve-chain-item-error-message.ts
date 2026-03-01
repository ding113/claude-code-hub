import type { ProviderChainItem } from "@/types/message";

export function resolveChainItemErrorMessage(
  item: ProviderChainItem,
  tErrors: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (typeof item.errorMessage === "string" && item.errorMessage.trim()) {
    return item.errorMessage;
  }

  const errorCode = typeof item.errorCode === "string" ? item.errorCode.trim() : "";
  if (!errorCode) {
    return null;
  }

  try {
    return tErrors(errorCode, item.errorParams ?? undefined);
  } catch {
    return errorCode;
  }
}
