import { ProxyAuthenticator } from "./auth-guard";
import { ProxyMessageService } from "./message-service";
import { ProxyProviderResolver } from "./provider-selector";
import { ProxyRateLimitGuard } from "./rate-limit-guard";
import { ProxyRequestFilter } from "./request-filter";
import { ProxySensitiveWordGuard } from "./sensitive-word-guard";
import type { ProxySession } from "./session";
import { ProxySessionGuard } from "./session-guard";
import { ProxyVersionGuard } from "./version-guard";

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
  | "version"
  | "probe"
  | "session"
  | "requestFilter"
  | "sensitive"
  | "rateLimit"
  | "provider"
  | "messageContext";

export interface GuardConfig {
  steps: GuardStepKey[];
}

export interface GuardPipeline {
  run(session: ProxySession): Promise<Response | null>;
}

// Concrete GuardStep implementations (adapters over existing guards)
const Steps: Record<GuardStepKey, GuardStep> = {
  auth: {
    name: "auth",
    async execute(session) {
      return ProxyAuthenticator.ensure(session);
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

    return {
      async run(session: ProxySession): Promise<Response | null> {
        for (const step of steps) {
          const res = await step.execute(session);
          if (res) return res; // early exit
        }
        return null;
      },
    };
  }

  // Convenience: build a pipeline from preset request type
  static fromRequestType(type: RequestType): GuardPipeline {
    switch (type) {
      case RequestType.COUNT_TOKENS:
        return GuardPipelineBuilder.build(COUNT_TOKENS_PIPELINE);
      default:
        return GuardPipelineBuilder.build(CHAT_PIPELINE);
    }
  }
}

// Preset configurations
export const CHAT_PIPELINE: GuardConfig = {
  // Full guard chain for normal chat requests
  steps: [
    "auth",
    "version",
    "probe",
    "session",
    "requestFilter",
    "sensitive",
    "rateLimit",
    "provider",
    "messageContext",
  ],
};

export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  // Minimal chain for count_tokens: no session, no sensitive, no rate limit, no message logging
  steps: ["auth", "version", "probe", "requestFilter", "provider"],
};
