import { ProxyAuthenticator } from "./auth-guard";
import { ProxyClientGuard } from "./client-guard";
import type { EndpointPolicy } from "./endpoint-policy";
import { ProxyMessageService } from "./message-service";
import { ProxyModelGuard } from "./model-guard";
import { ProxyProviderRequestFilter } from "./provider-request-filter";
import { ProxyProviderResolver } from "./provider-selector";
import { ProxyRateLimitGuard } from "./rate-limit-guard";
import { ProxyRequestFilter } from "./request-filter";
import { ProxySensitiveWordGuard } from "./sensitive-word-guard";
import type { ProxySession } from "./session";
import { ProxySessionGuard } from "./session-guard";
import { ProxyVersionGuard } from "./version-guard";
import { ProxyWarmupGuard } from "./warmup-guard";

// Request type classification for pipeline presets
export enum RequestType {
  CHAT = "CHAT",
  COUNT_TOKENS = "COUNT_TOKENS",
}

// A single guard step that can mutate session or produce an early Response
export interface GuardStep {
  name: string;
  execute(session: ProxySession): Promise<Response | null>;
}

// Pipeline configuration describes an ordered list of step keys
export type GuardStepKey =
  | "auth"
  | "client"
  | "model"
  | "version"
  | "probe"
  | "session"
  | "warmup"
  | "requestFilter"
  | "sensitive"
  | "rateLimit"
  | "provider"
  | "providerRequestFilter"
  | "messageContext";

export interface GuardConfig {
  steps: GuardStepKey[];
}

export interface GuardPipeline {
  run(session: ProxySession): Promise<Response | null>;
}

/**
 * Extension point for optional guard steps contributed by independent modules
 * (e.g. per-model rate limiting). Registered steps are spliced into a built
 * pipeline relative to their anchor step, and silently skipped for any preset
 * that does not contain the anchor.
 *
 * Anchor by exactly one of `insertAfter` / `insertBefore`. The model rate-limit
 * guard runs *before* `rateLimit` so it can set the per-axis bypass flags the
 * mainline cost gates read (§5.2).
 *
 * This is a stable public hook: keep it backward compatible across refactors
 * of this file (see tests/unit/proxy/guard-pipeline-extension.test.ts).
 */
export interface ExtensionStep {
  key: string; // unique id, used for idempotent dedup (dev hot reload)
  step: GuardStep;
  insertAfter?: GuardStepKey;
  insertBefore?: GuardStepKey;
}

// Backed by globalThis so the registry is a single shared instance across module
// copies. Next.js bundles `instrumentation.ts` separately from route handlers, so a
// plain module-level array would be registered into the instrumentation copy and
// read as empty by the proxy request path — the spliced guard would never run.
const extensionRegistry = globalThis as unknown as {
  __CCH_GUARD_EXTENSION_STEPS__?: ExtensionStep[];
};
const extensions: ExtensionStep[] =
  extensionRegistry.__CCH_GUARD_EXTENSION_STEPS__ ??
  (extensionRegistry.__CCH_GUARD_EXTENSION_STEPS__ = []);

export function registerExtensionStep(ext: ExtensionStep): void {
  if (extensions.some((e) => e.key === ext.key)) return;
  extensions.push(ext);
}

/** Test-only: reset registered extensions between cases. */
export function __clearExtensionSteps(): void {
  extensions.length = 0;
}

// Concrete GuardStep implementations (adapters over existing guards)
const Steps: Record<GuardStepKey, GuardStep> = {
  auth: {
    name: "auth",
    async execute(session) {
      return ProxyAuthenticator.ensure(session);
    },
  },
  client: {
    name: "client",
    async execute(session) {
      return ProxyClientGuard.ensure(session);
    },
  },
  model: {
    name: "model",
    async execute(session) {
      return ProxyModelGuard.ensure(session);
    },
  },
  version: {
    name: "version",
    async execute(session) {
      return ProxyVersionGuard.ensure(session);
    },
  },
  probe: {
    name: "probe",
    async execute(session) {
      if (session.isProbeRequest()) {
        return new Response(JSON.stringify({ input_tokens: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    },
  },
  session: {
    name: "session",
    async execute(session) {
      await ProxySessionGuard.ensure(session);
      return null;
    },
  },
  warmup: {
    name: "warmup",
    async execute(session) {
      return ProxyWarmupGuard.ensure(session);
    },
  },
  requestFilter: {
    name: "requestFilter",
    async execute(session) {
      await ProxyRequestFilter.ensure(session);
      return null;
    },
  },
  sensitive: {
    name: "sensitive",
    async execute(session) {
      return ProxySensitiveWordGuard.ensure(session);
    },
  },
  rateLimit: {
    name: "rateLimit",
    async execute(session) {
      await ProxyRateLimitGuard.ensure(session);
      return null;
    },
  },
  provider: {
    name: "provider",
    async execute(session) {
      return ProxyProviderResolver.ensure(session);
    },
  },
  providerRequestFilter: {
    name: "providerRequestFilter",
    async execute(session) {
      await ProxyProviderRequestFilter.ensure(session);
      return null;
    },
  },
  messageContext: {
    name: "messageContext",
    async execute(session) {
      await ProxyMessageService.ensureContext(session);
      return null;
    },
  },
};

export class GuardPipelineBuilder {
  // Assemble a pipeline from a configuration
  static build(config: GuardConfig): GuardPipeline {
    const steps: GuardStep[] = config.steps.map((k) => Steps[k]);

    for (const ext of extensions) {
      const anchor = ext.insertBefore ?? ext.insertAfter;
      const idx = steps.findIndex((s) => s.name === anchor);
      if (idx < 0) continue; // anchor absent → skip
      const at = ext.insertBefore !== undefined ? idx : idx + 1;
      steps.splice(at, 0, ext.step);
    }

    return {
      async run(session: ProxySession): Promise<Response | null> {
        try {
          for (const step of steps) {
            const res = await step.execute(session);
            if (res) return res; // early exit
          }
          return null;
        } catch (error) {
          // bugfix #03: a later guard (rateLimit / modelRateLimit) throwing
          // would otherwise leak the provider session ref ZADD'd by the
          // `provider` step until SESSION_TTL_MS. Release here so the
          // provider's active-session ZSET reflects reality.
          const { releaseAllProviderSessionRefs } = await import("./provider-session-cleanup");
          await releaseAllProviderSessionRefs(session);
          throw error;
        }
      },
    };
  }

  static fromSession(
    session: Pick<ProxySession, "getEndpointPolicy"> & {
      isRawCrossProviderFallbackEnabled?: (() => boolean) | undefined;
    }
  ): GuardPipeline {
    return GuardPipelineBuilder.fromEndpointPolicy(
      session.getEndpointPolicy(),
      typeof session.isRawCrossProviderFallbackEnabled === "function"
        ? session.isRawCrossProviderFallbackEnabled()
        : session.getEndpointPolicy().allowRawCrossProviderFallback
    );
  }

  static fromEndpointPolicy(
    policy: Pick<EndpointPolicy, "guardPreset" | "allowRawCrossProviderFallback">,
    rawCrossProviderFallbackEnabled = policy.allowRawCrossProviderFallback
  ): GuardPipeline {
    switch (policy.guardPreset) {
      case "raw_passthrough":
        return GuardPipelineBuilder.build(
          rawCrossProviderFallbackEnabled ? RAW_SAFE_SESSION_PIPELINE : RAW_PASSTHROUGH_PIPELINE
        );
      default:
        return GuardPipelineBuilder.build(CHAT_PIPELINE);
    }
  }

  // Convenience: build a pipeline from preset request type
  static fromRequestType(type: RequestType): GuardPipeline {
    switch (type) {
      case RequestType.COUNT_TOKENS:
        return GuardPipelineBuilder.build(RAW_SAFE_SESSION_PIPELINE);
      default:
        return GuardPipelineBuilder.build(CHAT_PIPELINE);
    }
  }
}

// Preset configurations
export const CHAT_PIPELINE: GuardConfig = {
  // Full guard chain for normal chat requests.
  //
  // `rateLimit` runs AFTER `provider` so that the model-rate-limit extension
  // (registered with insertBefore "rateLimit") lands between provider selection
  // and the global cost gate. The model-group lookup needs the upstream model
  // name (post-redirect) to match `usage_ledger.model`; provider selection is
  // what makes that name knowable via `ModelRedirector.getRedirectedModel`.
  steps: [
    "auth",
    "sensitive",
    "client",
    "model",
    "version",
    "probe",
    "session",
    "warmup",
    "requestFilter",
    "provider",
    "rateLimit",
    "providerRequestFilter",
    "messageContext",
  ],
};

export const RAW_PASSTHROUGH_PIPELINE: GuardConfig = {
  steps: ["auth", "client", "model", "version", "probe", "provider"],
};

export const RAW_SAFE_SESSION_PIPELINE: GuardConfig = {
  steps: ["auth", "client", "model", "version", "probe", "session", "provider", "messageContext"],
};

export const COUNT_TOKENS_PIPELINE: GuardConfig = RAW_SAFE_SESSION_PIPELINE;
