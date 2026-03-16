export type EndpointClientFormat = "response" | "openai" | "claude" | "gemini" | "gemini-cli";

export type EndpointAccountingTier = "required_usage" | "optional_usage" | "none";

export interface EndpointFamily {
  readonly id: string;
  readonly surface: EndpointClientFormat;
  readonly accountingTier: EndpointAccountingTier;
  readonly modelRequired: boolean;
  readonly rawPassthrough: boolean;
  readonly match: (normalizedPath: string) => boolean;
}

const GEMINI_GENERATION_ACTIONS = new Set(["generatecontent", "streamgeneratecontent"]);

function normalizePathname(pathname: string): string {
  const pathWithoutQuery = pathname.split("?")[0] ?? pathname;
  const trimmedPath =
    pathWithoutQuery.length > 1 && pathWithoutQuery.endsWith("/")
      ? pathWithoutQuery.slice(0, -1)
      : pathWithoutQuery;

  return trimmedPath.toLowerCase();
}

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchGeminiModelAction(
  pathname: string,
  prefix:
    | "/v1beta/models/"
    | "/v1/publishers/google/models/"
    | "/v1/models/"
    | "/v1internal/models/",
  actions: readonly string[]
): boolean {
  const actionPattern = actions.join("|");
  const regex = new RegExp(
    `^${prefix.replaceAll("/", String.raw`\/`)}[^/:]+:(?:${actionPattern})$`,
    "i"
  );
  return regex.test(pathname);
}

const KNOWN_ENDPOINT_FAMILIES: readonly EndpointFamily[] = Object.freeze([
  {
    id: "claude-messages",
    surface: "claude",
    accountingTier: "required_usage",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => pathname === "/v1/messages",
  },
  {
    id: "claude-count-tokens",
    surface: "claude",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: true,
    match: (pathname) => pathname === "/v1/messages/count_tokens",
  },
  {
    id: "response-compact",
    surface: "response",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: true,
    match: (pathname) => pathname === "/v1/responses/compact",
  },
  {
    id: "response-execution",
    surface: "response",
    accountingTier: "required_usage",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => pathname === "/v1/responses",
  },
  {
    id: "response-resources",
    surface: "response",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/responses"),
  },
  {
    id: "openai-chat-completions",
    surface: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) => pathname === "/v1/chat/completions",
  },
  {
    id: "openai-chat-completions-resources",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/chat/completions"),
  },
  {
    id: "openai-models",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => /^\/v1\/models(?:\/[^/:]+)?$/i.test(pathname),
  },
  {
    id: "gemini-generate-content",
    surface: "gemini",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["generatecontent"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["generatecontent"]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["generatecontent"]),
  },
  {
    id: "gemini-stream-generate-content",
    surface: "gemini",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["streamgeneratecontent"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", [
        "streamgeneratecontent",
      ]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["streamgeneratecontent"]),
  },
  {
    id: "gemini-count-tokens",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["counttokens"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["counttokens"]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["counttokens"]),
  },
  {
    id: "gemini-embed-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["embedcontent"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["embedcontent"]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["embedcontent"]),
  },
  {
    id: "gemini-batch-generate-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["batchgeneratecontent"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["batchgeneratecontent"]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["batchgeneratecontent"]),
  },
  {
    id: "gemini-batch-embed-contents",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["batchembedcontents"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["batchembedcontents"]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["batchembedcontents"]),
  },
  {
    id: "gemini-async-batch-embed-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["asyncbatchembedcontent"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", [
        "asyncbatchembedcontent",
      ]) ||
      matchGeminiModelAction(pathname, "/v1/models/", ["asyncbatchembedcontent"]),
  },
  {
    id: "gemini-predict",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["predict"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["predict"]),
  },
  {
    id: "gemini-predict-long-running",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1beta/models/", ["predictlongrunning"]) ||
      matchGeminiModelAction(pathname, "/v1/publishers/google/models/", ["predictlongrunning"]),
  },
  {
    id: "gemini-files",
    surface: "gemini",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1beta/files"),
  },
  {
    id: "gemini-models-resource",
    surface: "gemini",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) =>
      pathname === "/v1beta/models" ||
      /^\/v1beta\/models\/[^/:]+$/i.test(pathname) ||
      /^\/v1\/publishers\/google\/models\/[^/:]+$/i.test(pathname),
  },
  {
    id: "gemini-cli-generate-content",
    surface: "gemini-cli",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1internal/models/", ["generatecontent"]),
  },
  {
    id: "gemini-cli-stream-generate-content",
    surface: "gemini-cli",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelAction(pathname, "/v1internal/models/", ["streamgeneratecontent"]),
  },
  {
    id: "openai-completions",
    surface: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/completions"),
  },
  {
    id: "openai-embeddings",
    surface: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) => pathname === "/v1/embeddings",
  },
  {
    id: "openai-moderations",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/moderations"),
  },
  {
    id: "openai-audio-generation",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => pathname === "/v1/audio/speech",
  },
  {
    id: "openai-audio-transcription",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) =>
      pathname === "/v1/audio/transcriptions" || pathname === "/v1/audio/translations",
  },
  {
    id: "openai-audio-resources",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) =>
      hasPrefix(pathname, "/v1/audio/voice_consents") || hasPrefix(pathname, "/v1/audio/voices"),
  },
  {
    id: "openai-images",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/images"),
  },
  {
    id: "openai-files",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/files"),
  },
  {
    id: "openai-uploads",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/uploads"),
  },
  {
    id: "openai-batches",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/batches"),
  },
  {
    id: "openai-fine-tuning",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/fine_tuning"),
  },
  {
    id: "openai-evals",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/evals"),
  },
  {
    id: "openai-assistants",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/assistants"),
  },
  {
    id: "openai-threads",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/threads"),
  },
  {
    id: "openai-conversations",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/conversations"),
  },
  {
    id: "openai-vector-stores",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/vector_stores"),
  },
  {
    id: "openai-containers",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/containers"),
  },
  {
    id: "openai-realtime-http",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/realtime"),
  },
  {
    id: "openai-videos",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/videos"),
  },
  {
    id: "openai-skills",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/skills"),
  },
  {
    id: "openai-chatkit",
    surface: "openai",
    accountingTier: "none",
    modelRequired: false,
    rawPassthrough: false,
    match: (pathname) => hasPrefix(pathname, "/v1/chatkit"),
  },
]);

export function listKnownEndpointFamilies(): readonly EndpointFamily[] {
  return KNOWN_ENDPOINT_FAMILIES;
}

export function resolveEndpointFamilyByPath(pathname: string): EndpointFamily | null {
  const normalizedPath = normalizePathname(pathname);
  return KNOWN_ENDPOINT_FAMILIES.find((family) => family.match(normalizedPath)) ?? null;
}

export function detectEndpointFormat(pathname: string): EndpointClientFormat | null {
  return resolveEndpointFamilyByPath(pathname)?.surface ?? null;
}

export function isStandardProxyEndpointPath(pathname: string): boolean {
  return resolveEndpointFamilyByPath(pathname) !== null;
}

export function isGeminiGenerationEndpointPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  const matches = normalizedPath.match(/:([^/]+)$/);
  return matches?.[1] ? GEMINI_GENERATION_ACTIONS.has(matches[1]) : false;
}
