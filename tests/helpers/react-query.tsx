import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function withTestQueryClient(children: ReactNode, queryClient = createTestQueryClient()) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
