import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { db } from "@/drizzle/db";
import { providerEndpoints } from "@/drizzle/schema";
import {
  createProvider,
  deleteProvider,
  findProviderById,
  updateProvider,
} from "@/repository/provider";
import {
  ensureProviderEndpointExistsForUrl,
  findProviderEndpointsByVendorAndType,
  tryDeleteProviderVendorIfEmpty,
} from "@/repository/provider-endpoints";

const run = process.env.DSN ? describe : describe.skip;

function createDeferred() {
  let resolve: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: resolve!,
  };
}

run("Provider endpoint sync on edit (integration race)", () => {
  test("concurrent next-url insert should not break provider edit transaction", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const oldUrl = `https://race-${suffix}.example.com/v1/messages`;
    const nextUrl = `https://race-${suffix}.example.com/v2/messages`;
    const websiteUrl = `https://vendor-${suffix}.example.com`;

    const created = await createProvider({
      name: `Race Provider ${suffix}`,
      url: oldUrl,
      key: `sk-race-${suffix}`,
      provider_type: "claude",
      website_url: websiteUrl,
      favicon_url: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
    });

    const vendorId = created.providerVendorId;
    expect(vendorId).not.toBeNull();

    const [previousEndpoint] = await db
      .select({
        id: providerEndpoints.id,
      })
      .from(providerEndpoints)
      .where(
        and(
          eq(providerEndpoints.vendorId, vendorId!),
          eq(providerEndpoints.providerType, created.providerType),
          eq(providerEndpoints.url, oldUrl),
          isNull(providerEndpoints.deletedAt)
        )
      )
      .limit(1);

    expect(previousEndpoint).toBeDefined();

    const lockAcquired = createDeferred();
    const releaseLock = createDeferred();

    const lockTask = db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM provider_endpoints
        WHERE id = ${previousEndpoint!.id}
        FOR UPDATE
      `);

      lockAcquired.resolve();
      await releaseLock.promise;
    });

    let updatePromise: Promise<Awaited<ReturnType<typeof updateProvider>>> | null = null;

    try {
      await lockAcquired.promise;

      updatePromise = updateProvider(created.id, { url: nextUrl });

      await ensureProviderEndpointExistsForUrl({
        vendorId: vendorId!,
        providerType: created.providerType,
        url: nextUrl,
      });

      releaseLock.resolve();
      await lockTask;

      const updated = await updatePromise;
      expect(updated).not.toBeNull();
      expect(updated?.url).toBe(nextUrl);

      const [previousAfter] = await db
        .select({
          id: providerEndpoints.id,
          url: providerEndpoints.url,
          deletedAt: providerEndpoints.deletedAt,
          isEnabled: providerEndpoints.isEnabled,
        })
        .from(providerEndpoints)
        .where(eq(providerEndpoints.id, previousEndpoint!.id))
        .limit(1);

      expect(previousAfter).toBeDefined();
      expect(previousAfter?.url).toBe(oldUrl);
      expect(previousAfter?.deletedAt).toBeNull();
      expect(previousAfter?.isEnabled).toBe(true);

      const activeEndpoints = await findProviderEndpointsByVendorAndType(
        vendorId!,
        created.providerType
      );

      const nextActive = activeEndpoints.filter((endpoint) => endpoint.url === nextUrl);
      const previousActive = activeEndpoints.filter((endpoint) => endpoint.url === oldUrl);
      expect(nextActive).toHaveLength(1);
      expect(nextActive[0]?.isEnabled).toBe(true);
      expect(previousActive).toHaveLength(1);
      expect(previousActive[0]?.isEnabled).toBe(true);

      const providerAfter = await findProviderById(created.id);
      expect(providerAfter?.url).toBe(nextUrl);
    } finally {
      releaseLock.resolve();
      await lockTask.catch(() => {});

      await deleteProvider(created.id);
      if (vendorId) {
        await tryDeleteProviderVendorIfEmpty(vendorId).catch(() => {});
      }

      if (updatePromise) {
        await updatePromise.catch(() => {});
      }
    }
  });
});
