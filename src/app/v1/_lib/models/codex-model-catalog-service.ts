import { getCachedCodexModelCatalog } from "@/lib/cache/codex-model-catalog-cache";
import {
  CODEX_MODEL_CATALOG_MAX_BYTES,
  type CodexModelInfo,
  mergeCodexModelCatalog,
  projectCodexModelCatalog,
} from "@/lib/codex-model-catalog";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { findAllProvidersFresh } from "@/repository/provider";
import type { User } from "@/types/user";
import { isClientAllowedDetailed } from "../proxy/client-detector";
import { checkProviderGroupMatch, ProxyProviderResolver } from "../proxy/provider-selector";
import type { ProxySession } from "../proxy/session";
import { prepareCodexModelCatalogSource } from "./codex-model-catalog-fetcher";

export class CodexModelCatalogUnavailableError extends Error {
  constructor() {
    super("No eligible model catalog source is currently available");
    this.name = "CodexModelCatalogUnavailableError";
  }
}

export class CodexModelCatalogTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super("The projected model catalog exceeds the response byte limit");
    this.name = "CodexModelCatalogTooLargeError";
  }
}

export class CodexModelCatalogClientDeniedError extends Error {
  constructor() {
    super("The client is not allowed to access this model catalog");
    this.name = "CodexModelCatalogClientDeniedError";
  }
}

interface CatalogAuthState {
  user: Pick<User, "id" | "allowedModels" | "allowedClients" | "blockedClients">;
  key: { providerGroup: string | null };
}

/** Reuse inference client matching without creating a proxy session or reading a request body. */
function clientContext(headers: Headers): ProxySession {
  return {
    headers,
    userAgent: headers.get("user-agent"),
    request: { message: {} },
    getEndpoint: () => "/v1/models",
    isCountTokensRequest: () => false,
  } as unknown as ProxySession;
}

/** Cache only source metadata; evaluate the current caller's permissions on every response. */
export async function getCodexModelCatalog(
  authState: CatalogAuthState,
  clientVersion: string,
  requestHeaders: Headers
): Promise<{ models: CodexModelInfo[] }> {
  const startedAt = Date.now();
  const client = clientContext(requestHeaders);
  if (
    !isClientAllowedDetailed(
      client,
      authState.user.allowedClients ?? [],
      authState.user.blockedClients ?? []
    ).allowed
  ) {
    throw new CodexModelCatalogClientDeniedError();
  }

  const [providers, timezone] = await Promise.all([
    findAllProvidersFresh(),
    resolveSystemTimezone(),
  ]);
  const effectiveGroup = authState.key.providerGroup || PROVIDER_GROUP.DEFAULT;
  const eligibleProviders = providers.filter(
    (provider) =>
      provider.isEnabled &&
      provider.providerType === "codex" &&
      isProviderActiveNow(provider.activeTimeStart, provider.activeTimeEnd, timezone) &&
      checkProviderGroupMatch(provider.groupTag, effectiveGroup) &&
      isClientAllowedDetailed(client, provider.allowedClients ?? [], provider.blockedClients ?? [])
        .allowed
  );

  if (eligibleProviders.length === 0) return { models: [] };

  const sources = await Promise.all(
    eligibleProviders.map(async (provider) => {
      let source: ReturnType<typeof prepareCodexModelCatalogSource>;
      try {
        source = prepareCodexModelCatalogSource(provider, clientVersion, requestHeaders);
      } catch {
        logger.warn("[CodexModelCatalog] Source preparation failed", {
          providerId: provider.id,
        });
        return null;
      }

      try {
        const snapshot = await getCachedCodexModelCatalog(source);
        if (snapshot === null) return null;
        return {
          provider: {
            id: provider.id,
            priority: ProxyProviderResolver.resolveEffectivePriority(provider, effectiveGroup),
          },
          models: projectCodexModelCatalog(snapshot.models, provider, authState.user.allowedModels),
          state: snapshot.state,
        };
      } catch {
        logger.warn("[CodexModelCatalog] Source lookup failed", {
          providerId: provider.id,
        });
        return null;
      }
    })
  );

  const availableSources = sources.filter((source) => source !== null);
  if (availableSources.length === 0) throw new CodexModelCatalogUnavailableError();

  const catalog = mergeCodexModelCatalog(availableSources);
  const bytes = Buffer.byteLength(JSON.stringify(catalog), "utf8");
  if (bytes > CODEX_MODEL_CATALOG_MAX_BYTES) throw new CodexModelCatalogTooLargeError(bytes);

  logger.info("[CodexModelCatalog] Response projected", {
    eligibleSources: eligibleProviders.length,
    availableSources: availableSources.length,
    modelCount: catalog.models.length,
    bytes,
    elapsedMs: Date.now() - startedAt,
    cacheStates: availableSources.map((source) => source.state),
  });
  return catalog;
}
