import { logger } from "@/lib/logger";
import { validateApiKeyAndGetUser } from "@/repository/key";
import { markUserExpired } from "@/repository/user";
import { GEMINI_PROTOCOL } from "../gemini/protocol";
import { ProxyResponses } from "./responses";
import type { AuthState, ProxySession } from "./session";

export class ProxyAuthenticator {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const authHeader = session.headers.get("authorization") ?? undefined;
    const apiKeyHeader = session.headers.get("x-api-key") ?? undefined;
    // Gemini CLI 认证：支持 x-goog-api-key 头部和 key 查询参数
    const geminiApiKeyHeader = session.headers.get(GEMINI_PROTOCOL.HEADERS.API_KEY) ?? undefined;
    const geminiApiKeyQuery = session.requestUrl.searchParams.get("key") ?? undefined;

    const authState = await ProxyAuthenticator.validate({
      authHeader,
      apiKeyHeader,
      geminiApiKeyHeader,
      geminiApiKeyQuery,
    });
    session.setAuthState(authState);

    if (authState.success) {
      return null;
    }

    return ProxyResponses.buildError(401, "令牌已过期或验证不正确");
  }

  private static async validate(headers: {
    authHeader?: string;
    apiKeyHeader?: string;
    geminiApiKeyHeader?: string;
    geminiApiKeyQuery?: string;
  }): Promise<AuthState> {
    const bearerKey = ProxyAuthenticator.extractKeyFromAuthorization(headers.authHeader);
    const apiKeyHeader = ProxyAuthenticator.normalizeKey(headers.apiKeyHeader);
    // Gemini API 密钥：优先使用头部，其次使用查询参数
    const geminiApiKey =
      ProxyAuthenticator.normalizeKey(headers.geminiApiKeyHeader) ||
      ProxyAuthenticator.normalizeKey(headers.geminiApiKeyQuery);

    const providedKeys = [bearerKey, apiKeyHeader, geminiApiKey].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );

    if (providedKeys.length === 0) {
      logger.debug("[ProxyAuthenticator] No authentication credentials found", {
        hasAuthHeader: !!headers.authHeader,
        hasApiKeyHeader: !!headers.apiKeyHeader,
        hasGeminiApiKeyHeader: !!headers.geminiApiKeyHeader,
        hasGeminiApiKeyQuery: !!headers.geminiApiKeyQuery,
      });
      return { user: null, key: null, apiKey: null, success: false };
    }

    const [firstKey] = providedKeys;
    const hasMismatch = providedKeys.some((key) => key !== firstKey);

    if (hasMismatch) {
      logger.warn("[ProxyAuthenticator] Multiple conflicting API keys provided", {
        keyCount: providedKeys.length,
      });
      return { user: null, key: null, apiKey: null, success: false };
    }

    const apiKey = firstKey;
    const authResult = await validateApiKeyAndGetUser(apiKey);

    if (!authResult) {
      logger.debug("[ProxyAuthenticator] API key validation failed", {
        apiKeyLength: apiKey.length,
        fromHeader: !!headers.authHeader || !!headers.apiKeyHeader || !!headers.geminiApiKeyHeader,
        fromQuery: !!headers.geminiApiKeyQuery,
      });
      return { user: null, key: null, apiKey, success: false };
    }

    // Check user status and expiration
    const { user } = authResult;

    // 1. Check if user is disabled
    if (!user.isEnabled) {
      logger.warn("[ProxyAuthenticator] User is disabled", {
        userId: user.id,
        userName: user.name,
      });
      return { user: null, key: null, apiKey, success: false };
    }

    // 2. Check if user is expired (lazy expiration check)
    if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
      logger.warn("[ProxyAuthenticator] User has expired", {
        userId: user.id,
        userName: user.name,
        expiresAt: user.expiresAt.toISOString(),
      });
      // Best-effort lazy mark user as disabled (idempotent)
      markUserExpired(user.id).catch((error) => {
        logger.error("[ProxyAuthenticator] Failed to mark user as expired", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return { user: null, key: null, apiKey, success: false };
    }

    logger.debug("[ProxyAuthenticator] Authentication successful", {
      userId: authResult.user.id,
      userName: authResult.user.name,
      keyName: authResult.key.name,
    });

    return { user: authResult.user, key: authResult.key, apiKey, success: true };
  }

  private static extractKeyFromAuthorization(authHeader?: string): string | null {
    if (!authHeader) {
      return null;
    }

    const trimmed = authHeader.trim();
    if (!trimmed) {
      return null;
    }

    const match = /^Bearer\s+(.+)$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    return match[1]?.trim() ?? null;
  }

  private static normalizeKey(value?: string): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
