export const GEMINI_PROTOCOL = {
  OFFICIAL_ENDPOINT: "https://generativelanguage.googleapis.com/v1beta",
  CLI_ENDPOINT: "https://cloudcode-pa.googleapis.com/v1internal",

  HEADERS: {
    API_KEY: "x-goog-api-key",
    GOOG_USER_PROJECT: "x-goog-user-project", // For countTokens
    CLIENT_METADATA: "client-metadata",
    API_CLIENT: "x-goog-api-client",
  },

  ERROR_CODES: {
    INVALID_ARGUMENT: 400,
    PERMISSION_DENIED: 403,
    NOT_FOUND: 404,
    RESOURCE_EXHAUSTED: 429,
    INTERNAL: 500,
    UNAVAILABLE: 503,
  },
};
