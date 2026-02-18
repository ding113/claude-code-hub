const V1_PREFIX = "/v1";

export const V1_ENDPOINT_PATHS = {
  MESSAGES: "/v1/messages",
  MESSAGES_COUNT_TOKENS: "/v1/messages/count_tokens",
  RESPONSES: "/v1/responses",
  RESPONSES_COMPACT: "/v1/responses/compact",
  CHAT_COMPLETIONS: "/v1/chat/completions",
  MODELS: "/v1/models",
} as const;

export const STANDARD_ENDPOINT_PATHS = [
  V1_ENDPOINT_PATHS.MESSAGES,
  V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
  V1_ENDPOINT_PATHS.RESPONSES,
  V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
  V1_ENDPOINT_PATHS.CHAT_COMPLETIONS,
  V1_ENDPOINT_PATHS.MODELS,
] as const;

export const STRICT_STANDARD_ENDPOINT_PATHS = [
  V1_ENDPOINT_PATHS.MESSAGES,
  V1_ENDPOINT_PATHS.RESPONSES,
  V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
  V1_ENDPOINT_PATHS.CHAT_COMPLETIONS,
] as const;

const standardEndpointPathSet = new Set<string>(STANDARD_ENDPOINT_PATHS);
const strictStandardEndpointPathSet = new Set<string>(STRICT_STANDARD_ENDPOINT_PATHS);

export function normalizeEndpointPath(pathname: string): string {
  const pathWithoutQuery = pathname.split("?")[0];
  const trimmedPath =
    pathWithoutQuery.length > 1 && pathWithoutQuery.endsWith("/")
      ? pathWithoutQuery.slice(0, -1)
      : pathWithoutQuery;

  return trimmedPath.toLowerCase();
}

export function isStandardEndpointPath(pathname: string): boolean {
  return standardEndpointPathSet.has(normalizeEndpointPath(pathname));
}

export function isStrictStandardEndpointPath(pathname: string): boolean {
  return strictStandardEndpointPathSet.has(normalizeEndpointPath(pathname));
}

export function isCountTokensEndpointPath(pathname: string): boolean {
  return normalizeEndpointPath(pathname) === V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS;
}

export function isResponseCompactEndpointPath(pathname: string): boolean {
  return normalizeEndpointPath(pathname) === V1_ENDPOINT_PATHS.RESPONSES_COMPACT;
}

export function toV1RoutePath(pathname: string): string {
  if (!pathname.startsWith(V1_PREFIX)) {
    return pathname;
  }

  const routePath = pathname.slice(V1_PREFIX.length);
  return routePath.length > 0 ? routePath : "/";
}
