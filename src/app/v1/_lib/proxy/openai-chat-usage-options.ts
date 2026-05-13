const OPENAI_COMPATIBLE_PROVIDER_TYPES = new Set(["openai-compatible"]);

export function ensureOpenAIChatStreamUsageOption(
  body: Record<string, unknown>,
  providerType: string | null | undefined,
  requestPath: string
): boolean {
  if (!OPENAI_COMPATIBLE_PROVIDER_TYPES.has(providerType ?? "")) {
    return false;
  }

  if (requestPath !== "/v1/chat/completions" || body.stream !== true) {
    return false;
  }

  const streamOptions = body.stream_options;
  if (streamOptions == null) {
    body.stream_options = { include_usage: true };
    return true;
  }

  if (typeof streamOptions !== "object" || Array.isArray(streamOptions)) {
    return false;
  }

  const streamOptionsRecord = streamOptions as Record<string, unknown>;
  if (streamOptionsRecord.include_usage === true) {
    return false;
  }

  body.stream_options = {
    ...streamOptionsRecord,
    include_usage: true,
  };
  return true;
}
