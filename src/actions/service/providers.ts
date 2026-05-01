import { isNull } from "drizzle-orm";
import type { ActionResult } from "@/actions/types";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { createProvider, deleteProvider, updateProvider } from "@/repository/provider";
import { createProviderGroup, findProviderGroupByName } from "@/repository/provider-groups";

/**
 * 生成 Provider 组合唯一键
 */
function makeProviderKey(p: {
  name: string;
  url: string;
  key: string;
  providerType: string;
}): string {
  return `${p.name}|${p.url}|${p.key}|${p.providerType}`;
}

/**
 * 批量同步 Providers（幂等）
 * POST /api/service/providers/batchSync
 *
 * 对比输入列表与数据库，执行增删改操作：
 * - 新增：列表有而数据库没有
 * - 更新：列表和数据库同时有
 * - 移除：列表没有数据库有（软删除）
 *
 * 唯一性判断：按 name + url + key + providerType 组合
 */
export async function batchSyncProviders(params: {
  providers: Array<{
    name: string;
    url: string;
    apiKey: string;
    providerType: "claude" | "codex" | "gemini" | "openai-compatible";
    providerGroup: string;
    models?: string[];
  }>;
}): Promise<
  ActionResult<{
    created: number;
    updated: number;
    removed: number;
  }>
> {
  try {
    const { providers: inputProviders } = params;

    // 1. 确保所有 providerGroup 存在
    const uniqueGroups = [...new Set(inputProviders.map((p) => p.providerGroup))];
    for (const groupName of uniqueGroups) {
      const existingGroup = await findProviderGroupByName(groupName);
      if (!existingGroup) {
        await createProviderGroup({ name: groupName, costMultiplier: 1.0 });
        logger.info("[ServiceProviders] Created provider group", { group: groupName });
      }
    }

    // 2. 查询数据库中所有未删除的 providers
    const dbProviders = await db.query.providers.findMany({
      where: isNull(providers.deletedAt),
    });

    // 3. 构建组合键映射 (name + url + key + providerType)
    const inputKeys = new Set(
      inputProviders.map((p) =>
        makeProviderKey({
          name: p.name,
          url: p.url,
          key: p.apiKey,
          providerType: p.providerType,
        })
      )
    );

    const dbProvidersMap = new Map(
      dbProviders.map((p) => [
        makeProviderKey({
          name: p.name,
          url: p.url,
          key: p.key,
          providerType: p.providerType,
        }),
        p,
      ])
    );

    let createdCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    // 4. 新增 & 更新
    for (const input of inputProviders) {
      const key = makeProviderKey({
        name: input.name,
        url: input.url,
        key: input.apiKey,
        providerType: input.providerType,
      });
      const existingProvider = dbProvidersMap.get(key);

      if (existingProvider) {
        // 更新已有 Provider
        const updated = await updateProvider(existingProvider.id, {
          name: input.name,
          url: input.url,
          key: input.apiKey,
          provider_type: input.providerType,
          group_tag: input.providerGroup,
          allowed_models: input.models,
        });

        if (updated) {
          updatedCount++;
          logger.info("[ServiceProviders] Updated provider", { providerId: updated.id });
        }
      } else {
        // 创建新 Provider
        const created = await createProvider({
          name: input.name,
          url: input.url,
          key: input.apiKey,
          provider_type: input.providerType,
          is_enabled: true,
          group_tag: input.providerGroup,
          allowed_models: input.models,
          weight: 100,
          priority: 0,
          // 废弃字段，必须提供
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        });

        createdCount++;
        logger.info("[ServiceProviders] Created provider", { providerId: created.id });
      }
    }

    // 5. 移除（软删除）列表没有而数据库有的
    for (const dbProvider of dbProviders) {
      const key = makeProviderKey({
        name: dbProvider.name,
        url: dbProvider.url,
        key: dbProvider.key,
        providerType: dbProvider.providerType,
      });
      if (!inputKeys.has(key)) {
        await deleteProvider(dbProvider.id);
        removedCount++;
        logger.info("[ServiceProviders] Removed provider", { providerId: dbProvider.id });
      }
    }

    logger.info("[ServiceProviders] Batch sync completed", {
      created: createdCount,
      updated: updatedCount,
      removed: removedCount,
    });

    return {
      ok: true,
      data: {
        created: createdCount,
        updated: updatedCount,
        removed: removedCount,
      },
    };
  } catch (error) {
    logger.error("[ServiceProviders] Failed to batch sync providers", { error });
    return { ok: false, error: "Failed to batch sync providers" };
  }
}
