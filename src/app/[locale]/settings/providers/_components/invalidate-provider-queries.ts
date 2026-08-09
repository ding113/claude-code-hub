import type { QueryClient } from "@tanstack/react-query";

/** Invalidate and immediately refetch all active provider-related queries. */
export async function invalidateProviderQueries(queryClient: QueryClient): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) => {
    const key = query.queryKey[0];
    return (
      key === "providers" ||
      key === "providers-health" ||
      key === "providers-statistics" ||
      key === "provider-vendors" ||
      key === "provider-groups" ||
      key === "my-group-rates"
    );
  };

  await queryClient.invalidateQueries({ predicate, refetchType: "none" });
  await queryClient.refetchQueries({ predicate, type: "active" });
}
