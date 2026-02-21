import { isClientAllowed } from "./client-detector";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

export class ProxyClientGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const user = session.authState?.user;
    if (!user) {
      // No user context - skip check (authentication should have failed already)
      return null;
    }

    const allowedClients = user.allowedClients ?? [];
    const blockedClients = user.blockedClients ?? [];

    if (allowedClients.length === 0 && blockedClients.length === 0) {
      return null;
    }

    // User-Agent is only required when an allowlist is configured.
    // Blocklist-only: no UA can't match any block pattern, so the request passes through.
    const userAgent = session.userAgent?.trim();
    if (!userAgent && allowedClients.length > 0) {
      return ProxyResponses.buildError(
        400,
        "Client not allowed. User-Agent header is required when client restrictions are configured.",
        "invalid_request_error"
      );
    }

    const isAllowed = isClientAllowed(session, allowedClients, blockedClients);

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
