import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

/**
 * Client (CLI/IDE) restriction guard
 *
 * Validates that the client making the request is allowed based on User-Agent header matching.
 * This check is ONLY performed when the user has configured client restrictions (allowedClients).
 *
 * Logic:
 * - If allowedClients is empty or undefined: skip all checks, allow request
 * - If allowedClients is non-empty:
 *   - Missing or empty User-Agent → 400 error
 *   - User-Agent doesn't match any allowed pattern → 400 error
 *   - User-Agent matches at least one pattern → allow request
 *
 * Matching: case-insensitive substring match
 */
export class ProxyClientGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const user = session.authState?.user;
    if (!user) {
      // No user context - skip check (authentication should have failed already)
      return null;
    }

    // Check if client restrictions are configured
    const allowedClients = user.allowedClients ?? [];
    if (allowedClients.length === 0) {
      // No restrictions configured - skip all checks
      return null;
    }

    // Restrictions exist - now User-Agent is required
    const userAgent = session.userAgent;

    // Missing or empty User-Agent when restrictions exist
    if (!userAgent || userAgent.trim() === "") {
      return ProxyResponses.buildError(
        400,
        "Client not allowed. User-Agent header is required when client restrictions are configured.",
        "invalid_request_error"
      );
    }

    // Case-insensitive substring match
    const userAgentLower = userAgent.toLowerCase();
    const isAllowed = allowedClients.some((pattern) =>
      userAgentLower.includes(pattern.toLowerCase())
    );

    if (!isAllowed) {
      return ProxyResponses.buildError(
        400,
        `Client not allowed. Your client is not in the allowed list.`,
        "invalid_request_error"
      );
    }

    // Client is allowed
    return null;
  }
}
