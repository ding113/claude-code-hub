import type { ProviderChainItem } from "@/types/message";

export function resolveChainItemErrorMessage(
  item: ProviderChainItem,
  tErrors: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (typeof item.errorMessage === "string" && item.errorMessage.trim()) {
    return item.errorMessage;
  }

  if (typeof item.errorCode !== "string" || !item.errorCode.trim()) {
    return null;
  }

  try {
    return tErrors(item.errorCode, item.errorParams ?? undefined);
  } catch {
    return item.errorCode;
  }
}
