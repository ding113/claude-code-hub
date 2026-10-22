import { hasValidPriceData } from "@/lib/utils/price-data";
import { findLatestPriceByModel } from "@/repository/model-price";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

/**
 * Model restriction guard
 *
 * Validates that the requested model is allowed based on user configuration.
 * This check is ONLY performed when the user has configured model restrictions (allowedModels).
 *
 * Logic:
 * - If allowedModels is empty or undefined: skip all checks, allow request
 * - If allowedModels is non-empty:
 *   - Missing or null model → 400 error
 *   - Model doesn't match any allowed pattern (exact, case-insensitive) → 400 error
 *   - Model matches at least one pattern → allow request
 *
 * Matching: case-insensitive exact match
 */
export class ProxyModelGuard {
  private static advisorModels(message: unknown): string[] {
    const tools = (message as { tools?: unknown } | null | undefined)?.tools;
    if (!Array.isArray(tools)) return [];
    const out: string[] = [];
    for (const tool of tools) {
      const t = tool as { type?: unknown; model?: unknown } | null;
      if (t && typeof t.type === "string" && t.type.startsWith("advisor_") && typeof t.model === "string" && t.model.trim()) {
        out.push(t.model.trim());
      }
    }
    return out;
  }

  static async ensure(session: ProxySession): Promise<Response | null> {
    const user = session.authState?.user;
    if (!user) {
      // No user context - skip check (authentication should have failed already)
      return null;
    }

    // Anthropic advisor tool (tools[].type advisor_*): the executor may consult the advisor model, which runs a separate billed
    // sub-inference on the operator's key. The advisor model is therefore held to the same allowedModels list as the request model,
    // and must have a price row (otherwise its passes could not be billed).
    const advisorModels = ProxyModelGuard.advisorModels(session.request.message);
    for (const advisor of advisorModels) {
      const restricted = user.allowedModels ?? [];
      if (restricted.length > 0 && !restricted.some((m) => m.toLowerCase() === advisor.toLowerCase())) {
        return ProxyResponses.buildError(
          400,
          `Model not allowed. The advisor model '${advisor}' is not in the allowed list.`,
          "invalid_request_error"
        );
      }
      const price = await findLatestPriceByModel(advisor);
      if (!price?.priceData || !hasValidPriceData(price.priceData)) {
        return ProxyResponses.buildError(
          400,
          `Advisor model '${advisor}' has no price configured.`,
          "invalid_request_error"
        );
      }
    }

    // Check if model restrictions are configured
    const allowedModels = user.allowedModels ?? [];
    if (allowedModels.length === 0) {
      // No restrictions configured - skip all checks
      return null;
    }

    // Restrictions exist - now model is required
    const requestedModel = session.request.model;

    // Missing or null model when restrictions exist
    if (!requestedModel || requestedModel.trim() === "") {
      return ProxyResponses.buildError(
        400,
        "Model not allowed. Model specification is required when model restrictions are configured.",
        "invalid_request_error"
      );
    }

    // Case-insensitive exact match
    const requestedModelLower = requestedModel.toLowerCase();
    const isAllowed = allowedModels.some(
      (pattern) => pattern.toLowerCase() === requestedModelLower
    );

    if (!isAllowed) {
      return ProxyResponses.buildError(
        400,
        `Model not allowed. The requested model '${requestedModel}' is not in the allowed list.`,
        "invalid_request_error"
      );
    }

    // Model is allowed
    return null;
  }
}
