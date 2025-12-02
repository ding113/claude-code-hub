import { fetch } from "undici";
import { logger } from "@/lib/logger";

export interface GeminiAuthCredentials {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  client_id?: string;
  client_secret?: string;
  type?: "authorized_user" | "service_account";
}

export class GeminiAuth {
  static isJson(key: string): boolean {
    return key.trim().startsWith("{");
  }

  static parse(key: string): GeminiAuthCredentials | string {
    if (GeminiAuth.isJson(key)) {
      try {
        return JSON.parse(key) as GeminiAuthCredentials;
      } catch {
        return key;
      }
    }
    return key;
  }

  static async getAccessToken(key: string): Promise<string> {
    const parsed = GeminiAuth.parse(key);
    if (typeof parsed === "string") {
      return parsed; // Assume it's an API Key or Access Token
    }

    // Check if access token is valid (if expires_at is provided)
    if (parsed.access_token && parsed.expires_at && parsed.expires_at > Date.now()) {
      return parsed.access_token;
    }

    // If we have an access token but no expiry, assume it's valid or let it fail
    if (parsed.access_token && !parsed.expires_at) {
      return parsed.access_token;
    }

    // Try to refresh if refresh_token exists
    if (parsed.refresh_token && parsed.client_id && parsed.client_secret) {
      try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: parsed.client_id,
            client_secret: parsed.client_secret,
            refresh_token: parsed.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to refresh token: ${response.statusText}`);
        }

        const data = (await response.json()) as { access_token?: string };
        if (data.access_token) {
          // Note: We are not persisting the new token back to DB here.
          // This means we might refresh more often than needed if the DB is not updated.
          // For a full implementation, the provider key should be updated.
          logger.info("Refreshed Gemini access token successfully");
          return data.access_token;
        }
      } catch (e) {
        logger.error("Error refreshing Gemini token", e);
      }
    }

    return parsed.access_token || "";
  }

  static isApiKey(key: string): boolean {
    const parsed = GeminiAuth.parse(key);
    return typeof parsed === "string" && !key.startsWith("ya29."); // ya29. is typical prefix for Google Access Tokens
  }
}
