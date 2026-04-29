"use client";

import { useModelSuggestionsByProviderGroup } from "@/lib/api-client/v1/providers/hooks";

/**
 * Hook to fetch model suggestions for autocomplete.
 * Returns an array of model names available for the given provider group.
 * @param providerGroup - The provider group to filter models by (comma-separated)
 */
export function useModelSuggestions(providerGroup?: string | null): string[] {
  const query = useModelSuggestionsByProviderGroup(providerGroup);
  return query.data?.items ?? [];
}
