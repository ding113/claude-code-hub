/**
 * /api/v1/provider-groups query keys
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const providerGroupsKeys = {
  all: [...v1Keys.all, "provider-groups"] as const,
  list: () => [...providerGroupsKeys.all, "list"] as const,
  detail: (id: number) => [...providerGroupsKeys.all, "detail", id] as const,
};
