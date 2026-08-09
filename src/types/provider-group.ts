/**
 * Provider group entity.
 * Maps to the provider_groups table.
 */

import type { ProviderGroupMatchRule } from "@/lib/provider-groups/match-rules";
import type { ProviderGroupModelMatchRule } from "@/lib/provider-groups/model-match-rules";
import type { ProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";

export type { ProviderGroupMatchRule, ProviderGroupModelMatchRule, ProviderGroupSharedSettings };

export interface ProviderGroup {
  id: number;
  name: string;
  costMultiplier: number;
  description: string | null;
  /**
   * Default model for scheduled health tests of providers in this group.
   * null / empty string = do not run scheduled health tests for this group.
   * @deprecated Use healthTestModels for new configuration.
   */
  healthTestModel: string | null;
  /** Multiple models tested independently for this group. */
  healthTestModels: string[];
  /** Test model used for non-test request models and aggregate health displays. */
  healthTestModelFallback: string | null;
  /** Shared fleet defaults (routing/network/circuit/limits). */
  sharedSettings: ProviderGroupSharedSettings | null;
  /** Lower first when classifying upstream site group names. */
  sortOrder: number;
  /** Keyword rules for site-group -> dispatch pool classification. */
  matchRules: ProviderGroupMatchRule[] | null;
  /** Request-model rules applied to providers in this dispatch group. */
  modelMatchRules: ProviderGroupModelMatchRule[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new provider group.
 */
export interface CreateProviderGroupInput {
  name: string;
  costMultiplier?: number;
  description?: string | null;
  healthTestModel?: string | null;
  healthTestModels?: string[] | null;
  healthTestModelFallback?: string | null;
  sharedSettings?: ProviderGroupSharedSettings | null;
  sortOrder?: number;
  matchRules?: ProviderGroupMatchRule[] | null;
  modelMatchRules?: ProviderGroupModelMatchRule[] | null;
}

/**
 * Input for updating a provider group.
 */
export interface UpdateProviderGroupInput {
  costMultiplier?: number;
  description?: string | null;
  healthTestModel?: string | null;
  healthTestModels?: string[] | null;
  healthTestModelFallback?: string | null;
  sharedSettings?: ProviderGroupSharedSettings | null;
  sortOrder?: number;
  matchRules?: ProviderGroupMatchRule[] | null;
  modelMatchRules?: ProviderGroupModelMatchRule[] | null;
}
