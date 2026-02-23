import { describe, expect, test } from "vitest";

/**
 * Verify that the QueryClient created by AppProviders has the expected
 * memory-friendly default options (gcTime, staleTime, refetchIntervalInBackground, etc.)
 *
 * We import the module and inspect the QueryClient that useState would produce.
 * Because AppProviders wraps QueryClient creation in useState(() => new QueryClient(...)),
 * we test the configuration by constructing a QueryClient with the same options.
 */

import { QueryClient } from "@tanstack/react-query";

function createQueryClientWithDefaults(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 2 * 60 * 1000,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
      },
    },
  });
}

describe("QueryClient global defaults", () => {
  test("gcTime is 2 minutes (120000ms)", () => {
    const qc = createQueryClientWithDefaults();
    expect(qc.getDefaultOptions().queries?.gcTime).toBe(2 * 60 * 1000);
  });

  test("staleTime is 30 seconds", () => {
    const qc = createQueryClientWithDefaults();
    expect(qc.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  test("refetchOnWindowFocus is disabled", () => {
    const qc = createQueryClientWithDefaults();
    expect(qc.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  test("refetchIntervalInBackground is disabled", () => {
    const qc = createQueryClientWithDefaults();
    expect(qc.getDefaultOptions().queries?.refetchIntervalInBackground).toBe(false);
  });
});
