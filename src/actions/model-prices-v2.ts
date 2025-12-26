"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { RemoteConfigSyncService } from "@/lib/remote-config";
import {
  createModelPriceV2 as createModelPriceV2Repo,
  deleteModelPriceV2ById,
  findAllLatestPricesV2,
  findModelPriceV2ById,
} from "@/repository/model-price-v2";
import { upsertRemoteConfigSync } from "@/repository/remote-config";
import type { ModelPriceData } from "@/types/model-price";
import type { ModelPriceV2 } from "@/types/model-price-v2";
import type { ActionResult } from "./types";

const PaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1),
    pageSize: z.coerce.number().int().min(1).max(500),
  })
  .strict();

const ModelNameSchema = z.string().trim().min(1).max(200);
const PriceDataSchema = z.record(z.string(), z.unknown());

const CreateModelPriceV2Schema = z
  .object({
    modelName: ModelNameSchema,
    priceData: PriceDataSchema,
  })
  .strict();

const UpdateModelPriceV2Schema = z
  .object({
    priceData: PriceDataSchema,
  })
  .strict();

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return Boolean(session && session.user.role === "admin");
}

function zodErrorToMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function createRemoteConfigSyncService(): RemoteConfigSyncService {
  const maybeMock = RemoteConfigSyncService as unknown as { mock?: unknown };
  const isVitestMockFn = typeof maybeMock.mock === "object";

  if (isVitestMockFn) {
    return (RemoteConfigSyncService as unknown as () => RemoteConfigSyncService)();
  }

  return new RemoteConfigSyncService();
}

// 仅创建一次，避免 Vitest 的 restoreAllMocks 清空 mockImplementation 后导致后续测试拿到 undefined
const remoteConfigSyncService = createRemoteConfigSyncService();

export interface PaginatedResult<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: T[];
}

export async function getModelPricesV2Paginated(params: {
  page: number;
  pageSize: number;
}): Promise<ActionResult<PaginatedResult<ModelPriceV2>>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = PaginationSchema.parse(params);
    const all = await findAllLatestPricesV2();

    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / validated.pageSize));
    const start = (validated.page - 1) * validated.pageSize;
    const end = start + validated.pageSize;

    return {
      ok: true,
      data: {
        page: validated.page,
        pageSize: validated.pageSize,
        total,
        totalPages,
        data: all.slice(start, end),
      },
    };
  } catch (error) {
    logger.error("[model-prices-v2.getModelPricesV2Paginated] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function createModelPriceV2(data: {
  modelName: string;
  priceData: ModelPriceData;
}): Promise<ActionResult<ModelPriceV2>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = CreateModelPriceV2Schema.parse(data);
    const created = await createModelPriceV2Repo({
      modelName: validated.modelName,
      priceData: validated.priceData,
      source: "user",
      isUserOverride: true,
      remoteVersion: null,
    });

    revalidatePath("/settings/prices-v2");
    return { ok: true, data: created };
  } catch (error) {
    logger.error("[model-prices-v2.createModelPriceV2] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function updateModelPriceV2(
  id: number,
  data: { priceData: ModelPriceData }
): Promise<ActionResult<ModelPriceV2>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const validated = UpdateModelPriceV2Schema.parse(data);

    const existing = await findModelPriceV2ById(validatedId);
    if (!existing) {
      return { ok: false, error: "价格记录不存在" };
    }

    const created = await createModelPriceV2Repo({
      modelName: existing.modelName,
      priceData: validated.priceData,
      source: "user",
      isUserOverride: true,
      remoteVersion: null,
    });

    revalidatePath("/settings/prices-v2");
    return { ok: true, data: created };
  } catch (error) {
    logger.error("[model-prices-v2.updateModelPriceV2] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function deleteModelPriceV2(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const deleted = await deleteModelPriceV2ById(validatedId);
    if (!deleted) {
      return { ok: false, error: "价格记录不存在" };
    }

    revalidatePath("/settings/prices-v2");
    return { ok: true };
  } catch (error) {
    logger.error("[model-prices-v2.deleteModelPriceV2] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export interface SyncPricesResult {
  remoteVersion: string;
  added: string[];
  updated: string[];
  unchanged: string[];
  skippedUserOverrides: string[];
}

function isPriceDataEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function syncPricesFromRemote(): Promise<ActionResult<SyncPricesResult>> {
  const now = new Date();

  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    await upsertRemoteConfigSync({
      configKey: "prices-override",
      lastAttemptAt: now,
      lastErrorMessage: null,
    });

    const remote = await remoteConfigSyncService.syncPrices();
    if (!remote.ok) {
      await upsertRemoteConfigSync({
        configKey: "prices-override",
        lastAttemptAt: now,
        lastErrorMessage: remote.error,
      });
      return { ok: false, error: remote.error };
    }

    const localLatest = await findAllLatestPricesV2();
    const localByModel = new Map(localLatest.map((price) => [price.modelName, price]));

    const added: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
    const skippedUserOverrides: string[] = [];

    for (const [modelName, priceData] of Object.entries(remote.data.prices)) {
      const model = ModelNameSchema.safeParse(modelName);
      if (!model.success) {
        continue;
      }

      const local = localByModel.get(modelName);
      if (!local) {
        await createModelPriceV2Repo({
          modelName,
          priceData: priceData as ModelPriceData,
          source: "remote",
          isUserOverride: false,
          remoteVersion: remote.remoteVersion,
        });
        added.push(modelName);
        continue;
      }

      if (local.isUserOverride) {
        skippedUserOverrides.push(modelName);
        continue;
      }

      if (isPriceDataEqual(local.priceData, priceData)) {
        unchanged.push(modelName);
        continue;
      }

      await createModelPriceV2Repo({
        modelName,
        priceData: priceData as ModelPriceData,
        source: "remote",
        isUserOverride: false,
        remoteVersion: remote.remoteVersion,
      });
      updated.push(modelName);
    }

    await upsertRemoteConfigSync({
      configKey: "prices-override",
      remoteVersion: remote.remoteVersion,
      lastAttemptAt: now,
      lastSyncedAt: now,
      lastErrorMessage: null,
    });

    revalidatePath("/settings/prices-v2");

    return {
      ok: true,
      data: {
        remoteVersion: remote.remoteVersion,
        added,
        updated,
        unchanged,
        skippedUserOverrides,
      },
    };
  } catch (error) {
    logger.error("[model-prices-v2.syncPricesFromRemote] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await upsertRemoteConfigSync({
      configKey: "prices-override",
      lastAttemptAt: now,
      lastErrorMessage: zodErrorToMessage(error),
    });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function restoreModelPriceToRemote(id: number): Promise<ActionResult<ModelPriceV2>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const existing = await findModelPriceV2ById(validatedId);
    if (!existing) {
      return { ok: false, error: "价格记录不存在" };
    }

    const remote = await remoteConfigSyncService.syncPrices();
    if (!remote.ok) {
      return { ok: false, error: remote.error };
    }

    const remotePrice = remote.data.prices[existing.modelName];
    if (!remotePrice) {
      return { ok: false, error: "远程价格表中不存在该模型" };
    }

    const created = await createModelPriceV2Repo({
      modelName: existing.modelName,
      priceData: remotePrice as ModelPriceData,
      source: "remote",
      isUserOverride: false,
      remoteVersion: remote.remoteVersion,
    });

    revalidatePath("/settings/prices-v2");
    return { ok: true, data: created };
  } catch (error) {
    logger.error("[model-prices-v2.restoreModelPriceToRemote] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}
