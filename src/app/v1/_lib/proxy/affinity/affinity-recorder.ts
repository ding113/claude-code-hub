import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import type { ProxySession } from "../session";
import { getAffinityStore } from "./affinity-store";
import { isAffinityRoutingEnabled } from "./config";
import { fingerprintTip } from "./fingerprint";

/**
 * F3a 亲和写回与墓碑（不变量：仅 owner 成功终态写回；软提名失败定向自愈）。
 * 全部 fire-and-forget 语义：任何失败只记日志，绝不影响请求主路径。
 */

/**
 * 成功终态写回：tip + sys 两键绑定到胜出供应商，滑动 TTL。
 * 调用点：流式 commitSideEffects（计费持久化成功后）与非流式成功分支。
 * replay serve / 竞速败者 / 失败重试不得调用。
 */
export async function recordAffinityWinner(
  session: ProxySession,
  providerId: number
): Promise<void> {
  const affinity = session.affinity;
  if (!affinity || providerId <= 0) return;
  try {
    if (!(await isAffinityRoutingEnabled())) return;
    const tip = fingerprintTip(affinity.chain);
    await getAffinityStore().put(
      affinity.scopeTag,
      tip.fp,
      affinity.chain.sys.fp,
      providerId,
      getEnvConfig().PREFIX_AFFINITY_TTL_SECONDS
    );
  } catch (error) {
    logger.debug("[AffinityRecorder] winner writeback failed", {
      error: error instanceof Error ? error.message : String(error),
      providerId,
    });
  }
}

/**
 * failover 墓碑：仅当失败供应商正是亲和提名的供应商时，对命中边界写短 TTL 墓碑，
 * 阻止后续请求羊群式撞向同一故障绑定；查找会跳过墓碑继续向浅回落。
 */
export async function tombstoneAffinityOnFailure(
  session: ProxySession,
  failedProviderId: number
): Promise<void> {
  const affinity = session.affinity;
  if (
    !affinity?.matchedFp ||
    affinity.nominatedProviderId === null ||
    affinity.nominatedProviderId !== failedProviderId
  ) {
    return;
  }
  try {
    if (!(await isAffinityRoutingEnabled())) return;
    await getAffinityStore().tombstone(affinity.scopeTag, affinity.matchedFp, "failover");
  } catch (error) {
    logger.debug("[AffinityRecorder] tombstone failed", {
      error: error instanceof Error ? error.message : String(error),
      failedProviderId,
    });
  }
}
