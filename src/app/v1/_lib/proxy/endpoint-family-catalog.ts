import { normalizeEndpointPath } from "./endpoint-paths";

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

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

type GeminiActionPrefix =
  | "/v1beta/models/"
  | "/v1/publishers/google/models/"
  | "/v1/models/"
  | "/v1internal/models/";

const GEMINI_STANDARD_MODEL_PREFIXES = [
  "/v1beta/models/",
  "/v1/publishers/google/models/",
  "/v1/models/",
] as const satisfies readonly GeminiActionPrefix[];

const GEMINI_PREDICT_MODEL_PREFIXES = [
  "/v1beta/models/",
  "/v1/publishers/google/models/",
] as const satisfies readonly GeminiActionPrefix[];

const GEMINI_CLI_MODEL_PREFIXES = [
  "/v1internal/models/",
] as const satisfies readonly GeminiActionPrefix[];

/**
 * 匹配受信任的 Gemini action 路径。
 *
 * 注意：`actions` 只能来自当前模块内的硬编码常量，绝不能接收用户输入。
 */
function matchGeminiModelAction(
  pathname: string,
  prefix: GeminiActionPrefix,
  actions: readonly string[]
): boolean {
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const remainder = pathname.slice(prefix.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0) {
    return false;
  }

  const model = remainder.slice(0, separatorIndex);
  const action = remainder.slice(separatorIndex + 1);
  if (!model || model.includes("/") || model.includes(":")) {
    return false;
  }

  return action.length > 0 && !action.includes("/") && actions.includes(action);
}

function matchGeminiModelActionOnPrefixes(
  pathname: string,
  prefixes: readonly GeminiActionPrefix[],
  actions: readonly string[]
): boolean {
  return prefixes.some((prefix) => matchGeminiModelAction(pathname, prefix, actions));
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
    accountingTier: "required_usage",
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
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, [
        "generatecontent",
      ]),
  },
  {
    id: "gemini-stream-generate-content",
    surface: "gemini",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, [
        "streamgeneratecontent",
      ]),
  },
  {
    id: "gemini-count-tokens",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, ["counttokens"]),
  },
  {
    id: "gemini-embed-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, ["embedcontent"]),
  },
  {
    id: "gemini-batch-generate-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, [
        "batchgeneratecontent",
      ]),
  },
  {
    id: "gemini-batch-embed-contents",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, [
        "batchembedcontents",
      ]),
  },
  {
    id: "gemini-async-batch-embed-content",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_STANDARD_MODEL_PREFIXES, [
        "asyncbatchembedcontent",
      ]),
  },
  {
    id: "gemini-predict",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_PREDICT_MODEL_PREFIXES, ["predict"]),
  },
  {
    id: "gemini-predict-long-running",
    surface: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_PREDICT_MODEL_PREFIXES, [
        "predictlongrunning",
      ]),
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
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_CLI_MODEL_PREFIXES, ["generatecontent"]),
  },
  {
    id: "gemini-cli-stream-generate-content",
    surface: "gemini-cli",
    accountingTier: "required_usage",
    modelRequired: true,
    rawPassthrough: false,
    match: (pathname) =>
      matchGeminiModelActionOnPrefixes(pathname, GEMINI_CLI_MODEL_PREFIXES, [
        "streamgeneratecontent",
      ]),
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
  const normalizedPath = normalizeEndpointPath(pathname);
  return KNOWN_ENDPOINT_FAMILIES.find((family) => family.match(normalizedPath)) ?? null;
}

export function detectEndpointFormat(pathname: string): EndpointClientFormat | null {
  return resolveEndpointFamilyByPath(pathname)?.surface ?? null;
}

export function isStandardProxyEndpointPath(pathname: string): boolean {
  return resolveEndpointFamilyByPath(pathname) !== null;
}

export function isGeminiGenerationEndpointPath(pathname: string): boolean {
  const normalizedPath = normalizeEndpointPath(pathname);
  const matches = normalizedPath.match(/:([^/]+)$/);
  return matches?.[1] ? GEMINI_GENERATION_ACTIONS.has(matches[1]) : false;
}
