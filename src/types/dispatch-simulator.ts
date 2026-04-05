import type { ProviderType } from "@/types/provider";

export type DispatchSimulatorClientFormat = "claude" | "openai" | "response" | "gemini";

export type DispatchSimulatorStepName =
  | "groupFilter"
  | "formatCompatibility"
  | "enabledCheck"
  | "activeTime"
  | "modelAllowlist"
  | "healthAndLimits"
  | "priorityTiers"
  | "modelRedirect"
  | "endpointSummary";

export interface DispatchSimulatorInput {
  clientFormat: DispatchSimulatorClientFormat;
  modelName: string;
  groupTags: string[];
}

export interface DispatchSimulatorEndpointStats {
  total: number;
  enabled: number;
  circuitOpen: number;
  available: number;
}

export interface DispatchSimulatorProviderSnapshot {
  id: number;
  name: string;
  providerType: ProviderType;
  groupTag: string | null;
  priority: number;
  effectivePriority: number;
  weight: number;
  details?: string;
  redirectedModel?: string | null;
  endpointStats?: DispatchSimulatorEndpointStats | null;
}

export interface DispatchSimulatorStep {
  stepName: DispatchSimulatorStepName;
  stepIndex: number;
  inputCount: number;
  outputCount: number;
  filteredOut: DispatchSimulatorProviderSnapshot[];
  surviving: DispatchSimulatorProviderSnapshot[];
  note?: string;
}

export interface DispatchSimulatorPriorityProvider extends DispatchSimulatorProviderSnapshot {
  weightPercent: number;
}

export interface DispatchSimulatorPriorityTier {
  priority: number;
  providers: DispatchSimulatorPriorityProvider[];
  isSelected: boolean;
}

export interface DispatchSimulatorResult {
  steps: DispatchSimulatorStep[];
  priorityTiers: DispatchSimulatorPriorityTier[];
  totalProviders: number;
  finalCandidateCount: number;
  selectedPriority: number | null;
}
