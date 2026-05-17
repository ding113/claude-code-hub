export type ApiCredentialHeaders = {
  authorization?: string | null;
  "x-api-key"?: string | null;
  "x-goog-api-key"?: string | null;
};

export type ApiCredentialSource = "bearer" | "api-key" | "goog-api-key" | "none";

export type ExtractedApiCredential = {
  token: string | null;
  source: ApiCredentialSource;
};

export function extractApiCredentialFromHeaders(
  headers: ApiCredentialHeaders
): ExtractedApiCredential {
  const authHeader = headers.authorization?.trim();
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const token = match?.[1]?.trim();
    if (token) {
      return { token, source: "bearer" };
    }
  }

  const apiKey = headers["x-api-key"]?.trim();
  if (apiKey) {
    return { token: apiKey, source: "api-key" };
  }

  const googApiKey = headers["x-goog-api-key"]?.trim();
  if (googApiKey) {
    return { token: googApiKey, source: "goog-api-key" };
  }

  return { token: null, source: "none" };
}

export function extractApiKeyFromHeaders(headers: ApiCredentialHeaders): string | null {
  return extractApiCredentialFromHeaders(headers).token;
}
