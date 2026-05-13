import { ApiError } from "@/lib/api-client/v1/errors";
import type { SystemSettings } from "@/types/system-config";
import { apiGet, apiPut, toActionResult } from "./_compat";

export function getSystemSettings() {
  return apiGet<SystemSettings>("/api/v1/system/settings").catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 403 && error.errorCode === "auth.forbidden") {
      return apiGet<SystemSettings>("/api/v1/system/display-settings");
    }
    throw error;
  });
}

export function fetchSystemSettings() {
  return toActionResult(getSystemSettings());
}

export function saveSystemSettings(data: unknown) {
  return toActionResult(
    apiPut<SystemSettings & { publicStatusProjectionWarningCode?: string | null }>(
      "/api/v1/system/settings",
      data
    )
  );
}

export function getServerTimeZone() {
  return toActionResult(apiGet<{ timeZone: string }>("/api/v1/system/timezone"));
}
