import { extractApiKeyFromHeaders as sharedExtractApiKeyFromHeaders } from "@/lib/api/auth-header-extractor";
import { getClientIpWithFreshSettings } from "@/lib/ip";
import { logger } from "@/lib/logger";
import { LoginAbusePolicy } from "@/lib/security/login-abuse-policy";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";
import { resolveApiKeyAuthOutcome } from "@/repository/key";
import { markUserExpired } from "@/repository/user";
import { GEMINI_PROTOCOL } from "../gemini/protocol";
import { ProxyResponses } from "./responses";
import type { AuthFailureKind, AuthState, ProxySession } from "./session";

async function getRequestLocale(): Promise<string> {
  // Match the rate-limit-guard pattern: read next-intl's request locale
  // (Accept-Language or cookie) lazily inside the guard so the proxy hot
  // path does not pay the import cost on every cold start.
  const { getLocale } = await import("next-intl/server");
  return await getLocale();
}

/**
 * Build an auth failure AuthState. The factory exists so every call site is
 * forced (by the function signature) to supply both `failureKind` and an
 * `errorResponse` — preventing the footgun where a new failure branch could
 * forget to tag itself and silently get classified as a credentials failure
 * by the brute-force rate limiter.
 */
function buildAuthFailure(params: {
  failureKind: AuthFailureKind;
  errorResponse: Response;
  apiKey?: string | null;
}): AuthState {
  return {
    user: null,
    key: null,
    apiKey: params.apiKey ?? null,
    success: false,
    failureKind: params.failureKind,
    errorResponse: params.errorResponse,
  };
}

/**
 * Exhaustiveness helper. Calling this from a "should be unreachable" branch
 * gives a compile-time error when a new union member is added without an
 * explicit handler.
 */
function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled discriminant in ${context}: ${JSON.stringify(value)}`);
}

/**
 * Pre-auth rate limiter: throttles repeated authentication failures per IP
 * to prevent brute-force API key enumeration on /v1/* endpoints.
 *
 * Uses the same LoginAbusePolicy as the login route but with separate
 * thresholds appropriate for programmatic API access.
 */
const proxyAuthPolicy = new LoginAbusePolicy({
  maxAttemptsPerIp: 20,
  maxAttemptsPerKey: 20,
  windowSeconds: 300,
  lockoutSeconds: 600,
});

export class ProxyAuthenticator {
  static async ensure(session: ProxySession): Promise<Response | null> {
    // Pre-auth rate limit: block IPs with too many recent auth failures.
    // Extracted once here and stashed on the session for later consumers
    // (message-service / audit writer) so we only parse headers once.
    const clientIp = (await getClientIpWithFreshSettings(session.headers)) ?? "unknown";
    session.clientIp = clientIp === "unknown" ? null : clientIp;
    const authHeader = session.headers.get("authorization") ?? undefined;
    const apiKeyHeader = session.headers.get("x-api-key") ?? undefined;
    // Gemini CLI 认证：支持 x-goog-api-key 头部和 key 查询参数
    const geminiApiKeyHeader = session.headers.get(GEMINI_PROTOCOL.HEADERS.API_KEY) ?? undefined;
    const geminiApiKeyQuery = session.requestUrl.searchParams.get("key") ?? undefined;
    const candidateApiKey = ProxyAuthenticator.resolvePreAuthCandidateKey({
      authHeader,
      apiKeyHeader,
      geminiApiKeyHeader,
      geminiApiKeyQuery,
    });
    const rateLimitDecision = proxyAuthPolicy.check(clientIp, candidateApiKey ?? undefined);
    if (!rateLimitDecision.allowed) {
      const retryAfter = rateLimitDecision.retryAfterSeconds;
      const response = ProxyResponses.buildError(
        429,
        "Too many authentication failures. Please retry later.",
        "rate_limit_error"
      );
      if (retryAfter != null) {
        const headers = new Headers(response.headers);
        headers.set("Retry-After", String(retryAfter));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    }

    const authState = await ProxyAuthenticator.validate({
      authHeader,
      apiKeyHeader,
      geminiApiKeyHeader,
      geminiApiKeyQuery,
    });
    session.setAuthState(authState);

    if (authState.success) {
      proxyAuthPolicy.recordSuccess(clientIp, authState.apiKey ?? undefined);
      return null;
    }

    // Only `credentials` failures should feed the brute-force rate limiter.
    // `account_state` failures (key/user disabled or expired) match a real
    // record, so recording them would let an admin lock themselves out by
    // simply disabling a key and watching the owner retry.
    if (authState.failureKind !== "account_state") {
      proxyAuthPolicy.recordFailure(clientIp, authState.apiKey ?? candidateApiKey ?? undefined);
    }

    // 返回详细的错误信息，帮助用户快速定位问题
    return authState.errorResponse ?? ProxyResponses.buildError(401, "认证失败");
  }

  private static resolvePreAuthCandidateKey(headers: {
    authHeader?: string;
    apiKeyHeader?: string;
    geminiApiKeyHeader?: string;
    geminiApiKeyQuery?: string;
  }): string | null {
    const bearerKey = ProxyAuthenticator.extractKeyFromAuthorization(headers.authHeader);
    const apiKeyHeader = ProxyAuthenticator.normalizeKey(headers.apiKeyHeader);
    const geminiApiKey =
      ProxyAuthenticator.normalizeKey(headers.geminiApiKeyHeader) ||
      ProxyAuthenticator.normalizeKey(headers.geminiApiKeyQuery);

    const providedKeys = [bearerKey, apiKeyHeader, geminiApiKey].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );

    if (providedKeys.length === 0) {
      return null;
    }

    const [firstKey] = providedKeys;
    return providedKeys.every((key) => key === firstKey) ? firstKey : null;
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
      return buildAuthFailure({
        failureKind: "credentials",
        errorResponse: ProxyResponses.buildError(
          401,
          "未提供认证凭据。请在 Authorization 头部、x-api-key 头部或 x-goog-api-key 头部中包含 API 密钥。",
          "authentication_error"
        ),
      });
    }

    const [firstKey] = providedKeys;
    const hasMismatch = providedKeys.some((key) => key !== firstKey);

    if (hasMismatch) {
      logger.warn("[ProxyAuthenticator] Multiple conflicting API keys provided", {
        keyCount: providedKeys.length,
      });
      return buildAuthFailure({
        failureKind: "credentials",
        errorResponse: ProxyResponses.buildError(
          401,
          "提供了多个冲突的 API 密钥。请仅使用一种认证方式。",
          "authentication_error"
        ),
      });
    }

    const apiKey = firstKey;
    const outcome = await resolveApiKeyAuthOutcome(apiKey);

    if (!outcome.ok) {
      // Exhaustive switch: adding a new ApiKeyAuthFailureReason in the
      // repository layer will trigger a compile error in assertNever below
      // until this guard is updated, preventing a new variant from silently
      // falling into the wrong branch.
      const locale = await getRequestLocale();
      switch (outcome.reason) {
        case "not_found":
          logger.debug("[ProxyAuthenticator] API key validation failed: not found", {
            apiKeyLength: apiKey.length,
            fromHeader:
              !!headers.authHeader || !!headers.apiKeyHeader || !!headers.geminiApiKeyHeader,
            fromQuery: !!headers.geminiApiKeyQuery,
          });
          return buildAuthFailure({
            apiKey,
            failureKind: "credentials",
            errorResponse: ProxyResponses.buildError(
              401,
              await getErrorMessageServer(locale, ERROR_CODES.PROXY_INVALID_API_KEY),
              "invalid_api_key"
            ),
          });

        case "key_disabled":
          logger.warn("[ProxyAuthenticator] API key is disabled", {
            apiKeyLength: apiKey.length,
          });
          return buildAuthFailure({
            apiKey,
            failureKind: "account_state",
            errorResponse: ProxyResponses.buildError(
              401,
              await getErrorMessageServer(locale, ERROR_CODES.PROXY_API_KEY_DISABLED),
              "key_disabled"
            ),
          });

        case "key_expired":
          logger.warn("[ProxyAuthenticator] API key has expired", {
            apiKeyLength: apiKey.length,
          });
          return buildAuthFailure({
            apiKey,
            failureKind: "account_state",
            errorResponse: ProxyResponses.buildError(
              401,
              await getErrorMessageServer(locale, ERROR_CODES.PROXY_API_KEY_EXPIRED),
              "key_expired"
            ),
          });

        default:
          assertNever(outcome.reason, "ProxyAuthenticator.validate outcome.reason");
      }
    }

    // Check user status and expiration
    const { user } = outcome;

    // 1. Check if user is disabled
    if (!user.isEnabled) {
      logger.warn("[ProxyAuthenticator] User is disabled", {
        userId: user.id,
        userName: user.name,
      });
      return buildAuthFailure({
        apiKey,
        failureKind: "account_state",
        errorResponse: ProxyResponses.buildError(
          401,
          "用户账户已被禁用。请联系管理员。",
          "user_disabled"
        ),
      });
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
      return buildAuthFailure({
        apiKey,
        failureKind: "account_state",
        errorResponse: ProxyResponses.buildError(
          401,
          `用户账户已于 ${user.expiresAt.toISOString().split("T")[0]} 过期。请续费订阅。`,
          "user_expired"
        ),
      });
    }

    logger.debug("[ProxyAuthenticator] Authentication successful", {
      userId: outcome.user.id,
      userName: outcome.user.name,
      keyName: outcome.key.name,
    });

    return { user: outcome.user, key: outcome.key, apiKey, success: true };
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

/**
 * 从请求头中提取 API Key（独立函数，供非 Guard 流程使用）
 *
 * 支持多种认证方式：
 * - Authorization: Bearer <key>
 * - x-api-key: <key>
 * - x-goog-api-key: <key>（Gemini）
 */
export function extractApiKeyFromHeaders(headers: {
  authorization?: string | null;
  "x-api-key"?: string | null;
  "x-goog-api-key"?: string | null;
}): string | null {
  return sharedExtractApiKeyFromHeaders(headers);
}
