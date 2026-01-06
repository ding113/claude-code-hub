import { ProxyAuthenticator } from "./auth-guard";
import { ProxyClientGuard } from "./client-guard";
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
    "sensitive",
    "client",
    "model",
    "version",
    "probe",
    "session",
    "warmup",
    "requestFilter",
    "rateLimit",
    "provider",
    "providerRequestFilter",
    "messageContext",
  ],
};

export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  // Minimal chain for count_tokens: no session, no sensitive, no rate limit, no message logging
  steps: [
    "auth",
    "client",
    "model",
    "version",
    "probe",
    "requestFilter",
    "provider",
    "providerRequestFilter",
  ],
};
