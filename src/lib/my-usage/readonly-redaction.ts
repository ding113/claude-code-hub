import type { MyUsageLogEntry, MyUsageQuota } from "@/actions/my-usage";
import { isReadonlyKey } from "@/lib/auth/readonly-access";
import type { Key } from "@/types/key";

export function redactReadonlyQuota<T extends MyUsageQuota>(
  quota: T,
  key: Pick<Key, "canLoginWebUi">
): T {
  if (!isReadonlyKey(key)) {
    return quota;
  }

  return {
    ...quota,
    userAllowedModels: [],
    userAllowedClients: [],
    readonlyRedactedFields: ["userAllowedModels", "userAllowedClients"],
  };
}

export function redactReadonlyLogs<T extends MyUsageLogEntry[]>(
  logs: T,
  key: Pick<Key, "canLoginWebUi">
): T {
  if (!isReadonlyKey(key)) {
    return logs;
  }

  return logs.map((log) => ({
    ...log,
    endpoint: null,
  })) as T;
}
