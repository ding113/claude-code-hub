import type { SavePublicStatusSettingsInput } from "@/actions/public-status";
import { apiPut, toActionResult } from "./_compat";

export type { SavePublicStatusSettingsInput } from "@/actions/public-status";

export function savePublicStatusSettings(data: SavePublicStatusSettingsInput) {
  return toActionResult(apiPut("/api/v1/public/status/settings", data));
}
