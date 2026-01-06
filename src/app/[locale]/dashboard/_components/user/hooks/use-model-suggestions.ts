"use client";

import { useEffect, useState } from "react";
import { getModelSuggestionsByProviderGroup } from "@/actions/providers";

/**
 * Hook to fetch model suggestions for autocomplete.
 * Returns an array of model names available for the given provider group.
 * @param providerGroup - The provider group to filter models by (comma-separated)
 */
export function useModelSuggestions(providerGroup?: string | null): string[] {
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);

  useEffect(() => {
    getModelSuggestionsByProviderGroup(providerGroup)
      .then((res) => {
        if (res.ok && res.data) {
          setModelSuggestions(res.data);
          return;
        }
        setModelSuggestions([]);
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[useModelSuggestions] Failed to fetch model suggestions", error);
        }
        setModelSuggestions([]);
      });
  }, [providerGroup]);

  return modelSuggestions;
}
