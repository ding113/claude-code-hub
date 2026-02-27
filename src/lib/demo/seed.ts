import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import {
  keys,
  modelPrices,
  providers,
  providerVendors,
  usageLedger,
  users,
} from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

function gaussianSpike(x: number, center: number, width: number, height: number): number {
  const z = (x - center) / width;
  return Math.exp(-(z * z)) * height;
}

function formatCostUsd(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function shouldSeedDemoData(): boolean {
  const env = getEnvConfig();
  return env.NODE_ENV === "development" && env.CCH_EMBEDDED_DB && env.CCH_DEMO_SEED;
}

function buildHourlyRows(input: {
  date: Date;
  users: Array<{ id: number; key: string }>;
  providerId: number;
  requestIdStart: number;
}): { rows: Array<typeof usageLedger.$inferInsert>; nextRequestId: number } {
  const { date, users: demoUsers, providerId } = input;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const rows: Array<typeof usageLedger.$inferInsert> = [];
  let requestId = input.requestIdStart;

  for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
    const hourDate = new Date(start.getTime() + hourIndex * 60 * 60 * 1000);

    demoUsers.forEach((user, userIndex) => {
      const base =
        gaussianSpike(hourIndex, 8, 1.2, 3.2) +
        gaussianSpike(hourIndex, 17, 0.9, 1.9) +
        gaussianSpike(hourIndex, 21, 0.8, 0.8);
      const scaled = Math.max(0, base * (1 / (1 + userIndex * 0.65)));

      const calls = Math.min(6, Math.max(0, Math.round(scaled * 2.5)));
      if (calls === 0) return;

      const totalCost = Math.max(0.000_001, scaled * 0.008);
      const perCallCost = totalCost / calls;

      for (let callIndex = 0; callIndex < calls; callIndex++) {
        rows.push({
          requestId: requestId++,
          userId: user.id,
          key: user.key,
          providerId,
          finalProviderId: providerId,
          model: "demo-model",
          isSuccess: true,
          costUsd: formatCostUsd(perCallCost),
          createdAt: new Date(hourDate.getTime() + callIndex * 60 * 1000),
        });
      }
    });
  }

  return { rows, nextRequestId: requestId };
}

function buildDailyRows(input: {
  endDate: Date;
  days: number;
  users: Array<{ id: number; key: string }>;
  providerId: number;
  requestIdStart: number;
}): { rows: Array<typeof usageLedger.$inferInsert>; nextRequestId: number } {
  const { endDate, days, users: demoUsers, providerId } = input;

  const end = new Date(endDate);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - (days - 1));

  const rows: Array<typeof usageLedger.$inferInsert> = [];
  let requestId = input.requestIdStart;

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const day = new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);

    demoUsers.forEach((user, userIndex) => {
      const wave =
        gaussianSpike(dayIndex, Math.floor(days * 0.35), Math.max(1, days * 0.08), 12) +
        gaussianSpike(dayIndex, Math.floor(days * 0.75), Math.max(1, days * 0.06), 7);
      const scaled = Math.max(0, wave * (1 / (1 + userIndex * 0.6)));

      const calls = Math.min(10, Math.max(1, Math.round(scaled * 0.4)));
      const totalCost = Math.max(0.000_001, scaled * 0.02);
      const perCallCost = totalCost / calls;

      for (let callIndex = 0; callIndex < calls; callIndex++) {
        rows.push({
          requestId: requestId++,
          userId: user.id,
          key: user.key,
          providerId,
          finalProviderId: providerId,
          model: "demo-model",
          isSuccess: true,
          costUsd: formatCostUsd(perCallCost),
          createdAt: new Date(day.getTime() + callIndex * 10 * 60 * 1000),
        });
      }
    });
  }

  return { rows, nextRequestId: requestId };
}

export async function seedDemoDataIfNeeded(): Promise<void> {
  if (!shouldSeedDemoData()) {
    return;
  }

  await db.transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existingUser) {
      return;
    }

    logger.info("[DemoSeed] Seeding demo data...");

    const demoVendorDomain = "example.com";
    const demoVendorWebsiteUrl = "https://example.com";
    const demoProviderName = "demo-provider";

    const [existingVendor] = await tx
      .select({ id: providerVendors.id })
      .from(providerVendors)
      .where(eq(providerVendors.websiteDomain, demoVendorDomain))
      .limit(1);

    let vendorId = existingVendor?.id;
    if (!vendorId) {
      const inserted = await tx
        .insert(providerVendors)
        .values({
          websiteDomain: demoVendorDomain,
          displayName: "Demo Vendor",
          websiteUrl: demoVendorWebsiteUrl,
        })
        .onConflictDoNothing({ target: providerVendors.websiteDomain })
        .returning({ id: providerVendors.id });

      vendorId = inserted[0]?.id;
      if (!vendorId) {
        const [fallbackVendor] = await tx
          .select({ id: providerVendors.id })
          .from(providerVendors)
          .where(eq(providerVendors.websiteDomain, demoVendorDomain))
          .limit(1);
        vendorId = fallbackVendor?.id;
      }
    }

    if (!vendorId) {
      throw new Error("[DemoSeed] Failed to resolve provider vendor id");
    }

    const [existingProvider] = await tx
      .select({ id: providers.id, vendorId: providers.providerVendorId })
      .from(providers)
      .where(eq(providers.name, demoProviderName))
      .limit(1);

    let providerId = existingProvider?.id;
    if (!providerId) {
      const inserted = await tx
        .insert(providers)
        .values({
          name: demoProviderName,
          description: "Demo provider for local UI preview",
          url: "https://api.example.com",
          key: "demo-provider-key",
          providerVendorId: vendorId,
          isEnabled: true,
          weight: 1,
          priority: 0,
        })
        .returning({ id: providers.id });

      providerId = inserted[0]?.id;
    } else if (existingProvider.vendorId !== vendorId) {
      await tx
        .update(providers)
        .set({ providerVendorId: vendorId })
        .where(eq(providers.id, providerId));
    }

    if (!providerId) {
      throw new Error("[DemoSeed] Failed to resolve provider id");
    }

    const insertedUsers = await tx
      .insert(users)
      .values(
        Array.from({ length: 8 }, (_, index) => ({
          name: `u${index + 1}`,
          description: "Demo user",
          role: "user",
          isEnabled: true,
        }))
      )
      .returning({ id: users.id, name: users.name });

    const insertedKeys = await tx
      .insert(keys)
      .values(
        insertedUsers.map((user) => ({
          userId: user.id,
          name: `${user.name}-key`,
          key: `demo-${user.name}-key`,
          isEnabled: true,
          canLoginWebUi: true,
        }))
      )
      .returning({ userId: keys.userId, key: keys.key });

    const demoUsers = insertedKeys
      .map((k) => {
        const user = insertedUsers.find((u) => u.id === k.userId);
        return user ? { id: user.id, key: k.key } : null;
      })
      .filter((u): u is { id: number; key: string } => u !== null);

    const [{ maxRequestId }] = await tx
      .select({
        maxRequestId: sql<number>`COALESCE(MAX(${usageLedger.requestId}), 0)`,
      })
      .from(usageLedger);

    const startRequestId = (maxRequestId ?? 0) + 1;

    const now = new Date();
    const { rows: hourlyRows, nextRequestId } = buildHourlyRows({
      date: now,
      users: demoUsers,
      providerId,
      requestIdStart: startRequestId,
    });

    const { rows: dailyRows } = buildDailyRows({
      endDate: now,
      days: 30,
      users: demoUsers,
      providerId,
      requestIdStart: nextRequestId,
    });

    const ledgerRows = [...dailyRows, ...hourlyRows];
    if (ledgerRows.length > 0) {
      await tx.insert(usageLedger).values(ledgerRows);
    }

    const [existingPrice] = await tx.select({ id: modelPrices.id }).from(modelPrices).limit(1);
    if (!existingPrice) {
      await tx.insert(modelPrices).values({
        modelName: "demo-model",
        priceData: {
          mode: "chat",
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
          display_name: "Demo Model",
        },
        source: "manual",
      });
    }

    logger.info("[DemoSeed] Demo data ready", {
      users: insertedUsers.length,
      keys: insertedKeys.length,
      ledgerRows: ledgerRows.length,
    });
  });
}
