/**
 * Provider group entity.
 * Maps to the provider_groups table.
 */
export interface ProviderGroup {
  id: number;
  name: string;
  costMultiplier: number;
  description: string | null;
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
}

/**
 * Input for updating a provider group.
 */
export interface UpdateProviderGroupInput {
  costMultiplier?: number;
  description?: string | null;
}
