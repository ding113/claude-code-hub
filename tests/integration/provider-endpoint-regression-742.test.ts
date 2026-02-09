import { describe, expect, test } from "vitest";
import { createProvider, deleteProvider, updateProvider } from "@/repository/provider";
import {
  createProviderEndpoint,
  findProviderEndpointsByVendorAndType,
  softDeleteProviderEndpoint,
  tryDeleteProviderVendorIfEmpty,
} from "@/repository/provider-endpoints";

const run = process.env.DSN ? describe : describe.skip;

run("Provider endpoint regression #742", () => {
  test("sibling disappearance before fix: provider edit should keep non-target sibling endpoint visible", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const oldUrl = `https://742-${suffix}.example.com/v1/messages`;
    const siblingUrl = `https://742-${suffix}.example.com/v2/messages`;

    let providerId: number | null = null;
    let vendorId: number | null = null;
    let providerType:
      | "claude"
      | "claude-auth"
      | "codex"
      | "gemini-cli"
      | "gemini"
      | "openai-compatible"
      | null = null;

    try {
      const created = await createProvider({
        name: `Regression 742 ${suffix}`,
        url: oldUrl,
        key: `sk-742-${suffix}`,
        provider_type: "claude",
        website_url: `https://vendor-${suffix}.example.com`,
        favicon_url: null,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      providerId = created.id;
      vendorId = created.providerVendorId;
      providerType = created.providerType;

      expect(vendorId).not.toBeNull();

      await createProviderEndpoint({
        vendorId: vendorId!,
        providerType: providerType!,
        url: siblingUrl,
        label: "sibling",
      });

      const updated = await updateProvider(providerId, { url: siblingUrl });
      expect(updated?.url).toBe(siblingUrl);

      const activeEndpoints = await findProviderEndpointsByVendorAndType(vendorId!, providerType!);
      const activeUrls = activeEndpoints.map((endpoint) => endpoint.url).sort();

      expect(activeUrls).toEqual([oldUrl, siblingUrl].sort());
    } finally {
      if (providerId != null) {
        await deleteProvider(providerId).catch(() => false);
      }

      if (vendorId != null && providerType != null) {
        const activeEndpoints = await findProviderEndpointsByVendorAndType(
          vendorId,
          providerType
        ).catch(() => []);

        await Promise.all(
          activeEndpoints.map((endpoint) =>
            softDeleteProviderEndpoint(endpoint.id).catch(() => false)
          )
        );

        await tryDeleteProviderVendorIfEmpty(vendorId).catch(() => false);
      }
    }
  });
});
