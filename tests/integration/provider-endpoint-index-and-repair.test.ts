import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { db } from "../../src/drizzle/db";
import { providerEndpoints, providers, providerVendors } from "../../src/drizzle/schema";
import { backfillProviderEndpointsFromProviders } from "../../src/repository/provider-endpoints";

const run = process.env.DSN ? describe : describe.skip;

function makeSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createVendor(suffix: string): Promise<number> {
  const [vendor] = await db
    .insert(providerVendors)
    .values({
      websiteDomain: `endpoint-index-${suffix}.example.com`,
      websiteUrl: `https://endpoint-index-${suffix}.example.com`,
    })
    .returning({ id: providerVendors.id });

  if (!vendor) {
    throw new Error("failed to create test vendor");
  }

  return vendor.id;
}

async function cleanupVendor(vendorId: number): Promise<void> {
  await db.delete(providers).where(eq(providers.providerVendorId, vendorId));
  await db.delete(providerEndpoints).where(eq(providerEndpoints.vendorId, vendorId));
  await db.delete(providerVendors).where(eq(providerVendors.id, vendorId));
}

async function createProviderRow(input: {
  suffix: string;
  vendorId: number;
  url: string;
  providerType?: "claude";
}): Promise<number> {
  const [provider] = await db
    .insert(providers)
    .values({
      name: `endpoint-repair-${input.suffix}`,
      url: input.url,
      key: `sk-endpoint-repair-${input.suffix}`,
      providerVendorId: input.vendorId,
      providerType: input.providerType ?? "claude",
    })
    .returning({ id: providers.id });

  if (!provider) {
    throw new Error("failed to create test provider");
  }

  return provider.id;
}

async function countActiveEndpoints(input: {
  vendorId: number;
  providerType: "claude";
  url: string;
}): Promise<number> {
  const rows = await db
    .select({ id: providerEndpoints.id })
    .from(providerEndpoints)
    .where(
      and(
        eq(providerEndpoints.vendorId, input.vendorId),
        eq(providerEndpoints.providerType, input.providerType),
        eq(providerEndpoints.url, input.url),
        isNull(providerEndpoints.deletedAt)
      )
    );

  return rows.length;
}

function unwrapUniqueConstraintError(error: unknown): {
  code: string | null;
  constraint: string | null;
} {
  const value = error as {
    code?: string;
    constraint_name?: string;
    constraintName?: string;
    cause?: {
      code?: string;
      constraint_name?: string;
      constraintName?: string;
    };
  };

  return {
    code: value.code ?? value.cause?.code ?? null,
    constraint:
      value.constraint_name ??
      value.constraintName ??
      value.cause?.constraint_name ??
      value.cause?.constraintName ??
      null,
  };
}

async function expectUniqueViolation(query: Promise<unknown>): Promise<void> {
  try {
    await query;
    throw new Error("expected unique constraint violation");
  } catch (error) {
    const violation = unwrapUniqueConstraintError(error);
    expect(violation.code).toBe("23505");
    expect(violation.constraint).toBe("uniq_provider_endpoints_vendor_type_url");
  }
}

run("provider_endpoints active-only unique index", () => {
  test("active duplicates remain unique-guarded", async () => {
    const suffix = makeSuffix();
    const vendorId = await createVendor(suffix);
    const url = `https://active-dup-${suffix}.example.com/v1/messages`;

    try {
      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url,
      });

      await expectUniqueViolation(
        db.insert(providerEndpoints).values({
          vendorId,
          providerType: "claude",
          url,
        })
      );
    } finally {
      await cleanupVendor(vendorId);
    }
  });

  test("soft-deleted duplicates no longer block active inserts", async () => {
    const suffix = makeSuffix();
    const vendorId = await createVendor(suffix);
    const url = `https://soft-delete-insert-${suffix}.example.com/v1/messages`;

    try {
      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url,
        deletedAt: new Date(),
        isEnabled: false,
      });

      const inserted = await db
        .insert(providerEndpoints)
        .values({
          vendorId,
          providerType: "claude",
          url,
        })
        .returning({ id: providerEndpoints.id });

      expect(inserted).toHaveLength(1);

      const activeRows = await db
        .select({ id: providerEndpoints.id })
        .from(providerEndpoints)
        .where(
          and(
            eq(providerEndpoints.vendorId, vendorId),
            eq(providerEndpoints.providerType, "claude"),
            eq(providerEndpoints.url, url),
            isNull(providerEndpoints.deletedAt)
          )
        );

      expect(activeRows).toHaveLength(1);
    } finally {
      await cleanupVendor(vendorId);
    }
  });

  test("soft-deleted duplicates no longer block active updates", async () => {
    const suffix = makeSuffix();
    const vendorId = await createVendor(suffix);
    const oldUrl = `https://update-old-${suffix}.example.com/v1/messages`;
    const revivedUrl = `https://update-revive-${suffix}.example.com/v1/messages`;
    const conflictUrl = `https://update-conflict-${suffix}.example.com/v1/messages`;

    try {
      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url: revivedUrl,
        deletedAt: new Date(),
        isEnabled: false,
      });

      const [activeRow] = await db
        .insert(providerEndpoints)
        .values({
          vendorId,
          providerType: "claude",
          url: oldUrl,
        })
        .returning({ id: providerEndpoints.id });

      expect(activeRow).toBeDefined();

      const updated = await db
        .update(providerEndpoints)
        .set({ url: revivedUrl, updatedAt: new Date() })
        .where(eq(providerEndpoints.id, activeRow!.id))
        .returning({ id: providerEndpoints.id, url: providerEndpoints.url });

      expect(updated).toHaveLength(1);
      expect(updated[0]?.url).toBe(revivedUrl);

      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url: conflictUrl,
      });

      await expectUniqueViolation(
        db
          .update(providerEndpoints)
          .set({ url: conflictUrl, updatedAt: new Date() })
          .where(eq(providerEndpoints.id, activeRow!.id))
          .returning({ id: providerEndpoints.id })
      );
    } finally {
      await cleanupVendor(vendorId);
    }
  });
});

run("provider_endpoints deterministic repair flow", () => {
  test("dry-run reports deterministic and historical report-only candidates", async () => {
    const suffix = makeSuffix();
    const vendorId = await createVendor(suffix);
    const deterministicUrl = `https://repair-deterministic-${suffix}.example.com/v1/messages`;
    const historicalUrl = `https://repair-historical-${suffix}.example.com/v1/messages`;

    try {
      await createProviderRow({
        suffix: `${suffix}-deterministic`,
        vendorId,
        url: deterministicUrl,
      });
      await createProviderRow({
        suffix: `${suffix}-historical`,
        vendorId,
        url: historicalUrl,
      });

      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url: historicalUrl,
        deletedAt: new Date(),
        isEnabled: false,
      });

      const report = await backfillProviderEndpointsFromProviders({
        mode: "dry-run",
        vendorIds: [vendorId],
        sampleLimit: 200,
      });

      expect(report.mode).toBe("dry-run");
      expect(report.inserted).toBe(0);
      expect(report.repaired).toBe(0);
      expect(report.missingActiveEndpoints).toBe(2);
      expect(report.deterministicCandidates).toBe(1);
      expect(report.reportOnlyHistoricalCandidates).toBe(1);
      expect(report.riskSummary).toEqual({
        deterministicSafeInsert: 1,
        reportOnlyHistoricalAmbiguous: 1,
        reportOnlyInvalidProvider: 0,
      });

      expect(report.samples.deterministic).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            vendorId,
            url: deterministicUrl,
            risk: "deterministic-safe-insert",
            reason: "missing-active-endpoint",
          }),
        ])
      );
      expect(report.samples.reportOnlyHistorical).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            vendorId,
            url: historicalUrl,
            risk: "historical-ambiguous-report-only",
            reason: "historical-soft-deleted-endpoint-present",
          }),
        ])
      );

      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: deterministicUrl,
        })
      ).toBe(0);
      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: historicalUrl,
        })
      ).toBe(0);
    } finally {
      await cleanupVendor(vendorId);
    }
  });

  test("apply repairs deterministic candidates and remains idempotent", async () => {
    const suffix = makeSuffix();
    const vendorId = await createVendor(suffix);
    const deterministicUrl = `https://repair-apply-${suffix}.example.com/v1/messages`;
    const historicalUrl = `https://repair-apply-historical-${suffix}.example.com/v1/messages`;

    try {
      await createProviderRow({
        suffix: `${suffix}-apply-deterministic`,
        vendorId,
        url: deterministicUrl,
      });
      await createProviderRow({
        suffix: `${suffix}-apply-historical`,
        vendorId,
        url: historicalUrl,
      });

      await db.insert(providerEndpoints).values({
        vendorId,
        providerType: "claude",
        url: historicalUrl,
        deletedAt: new Date(),
        isEnabled: false,
      });

      const firstApply = await backfillProviderEndpointsFromProviders({
        mode: "apply",
        vendorIds: [vendorId],
        sampleLimit: 200,
      });

      expect(firstApply.mode).toBe("apply");
      expect(firstApply.missingActiveEndpoints).toBe(2);
      expect(firstApply.deterministicCandidates).toBe(1);
      expect(firstApply.reportOnlyHistoricalCandidates).toBe(1);
      expect(firstApply.repaired).toBe(1);
      expect(firstApply.inserted).toBe(1);

      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: deterministicUrl,
        })
      ).toBe(1);
      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: historicalUrl,
        })
      ).toBe(0);

      const secondApply = await backfillProviderEndpointsFromProviders({
        mode: "apply",
        vendorIds: [vendorId],
        sampleLimit: 200,
      });

      expect(secondApply.mode).toBe("apply");
      expect(secondApply.repaired).toBe(0);
      expect(secondApply.inserted).toBe(0);
      expect(secondApply.missingActiveEndpoints).toBe(1);
      expect(secondApply.deterministicCandidates).toBe(0);
      expect(secondApply.reportOnlyHistoricalCandidates).toBe(1);

      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: deterministicUrl,
        })
      ).toBe(1);
      expect(
        await countActiveEndpoints({
          vendorId,
          providerType: "claude",
          url: historicalUrl,
        })
      ).toBe(0);
    } finally {
      await cleanupVendor(vendorId);
    }
  });
});
