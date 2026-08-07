import { normalizeEndpointPath, V1_ENDPOINT_PATHS } from "./endpoint-paths";

export function isRemoteCompactionV2Request(pathname: string, requestBody: unknown): boolean {
  if (normalizeEndpointPath(pathname) !== V1_ENDPOINT_PATHS.RESPONSES) {
    return false;
  }
  if (typeof requestBody !== "object" || requestBody === null) {
    return false;
  }

  const input = (requestBody as Record<string, unknown>).input;
  if (!Array.isArray(input)) {
    return false;
  }

  return input.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).type === "compaction_trigger"
  );
}
