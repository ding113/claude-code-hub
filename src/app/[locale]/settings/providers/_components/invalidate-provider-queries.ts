import type { QueryClient } from "@tanstack/react-query";

/** Invalidate all provider-related queries in one batch */
export function invalidateProviderQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return (
        key === "providers" ||
        key === "providers-health" ||
        key === "providers-statistics" ||
        key === "provider-vendors"
      );
    },
  });
}
