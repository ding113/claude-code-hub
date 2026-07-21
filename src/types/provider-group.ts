/**
 * Provider group entity.
 * Maps to the provider_groups table.
 */
export interface ProviderGroup {
  id: number;
  name: string;
  costMultiplier: number;
  description: string | null;
  /**
   * Default model for scheduled health tests of providers in this group.
   * null / empty string = do not run scheduled health tests for this group.
   */
  healthTestModel: string | null;
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
}

/**
 * Input for updating a provider group.
 */
export interface UpdateProviderGroupInput {
  costMultiplier?: number;
  description?: string | null;
  healthTestModel?: string | null;
}
