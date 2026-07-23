import { randomUUID } from "node:crypto";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import type { ProxySession } from "../session";
import { deriveReplayIdentity, REPLAY_BYPASS_HEADER, type ReplayIdentity } from "./replay-identity";
import { getReplayStore, type ReplayMeta, type ReplayStore } from "./replay-store";

/**
 * F2 replayAttach guard 步骤：插在 requestFilter 之后、rateLimit 之前。
 *
 * 完全免费语义：命中重放的请求不占限流配额、不占供应商并发、不计费——
 * 但 auth/sensitive/client/model 等前置校验一律先行，绝不绕过鉴权。
 *
 * 角色分派（CCHP coordinator 状态机的移植）：
 * - meta completed（verifier 复核通过）  -> 全量重放（Redis 热层，miss 落 PG 持久层）
 * - meta owning + 心跳新鲜 + 去重开启    -> attach-live：吐已缓存前缀 + 轮询跟实时尾部
 * - miss / aborted / 心跳过期            -> 尝试 SET NX 抢 owner：成功则本请求成为 owner
 *                                          （挂 session.replayState，spool 由 handleStream 建），
 *                                          失败（竞态輸掉且不可 attach）则放弃 replay 照常执行
 * - verifier 不符（哈希碰撞）             -> 视为无 replay，照常执行
 * - x-cch-no-replay: 1                   -> 跳过 attach（有意重复采样），仍可成为 owner；
 *                                          但条目已 completed 时不 claim（不覆写，保留给其他客户端）
 *
 * 一切异常 fail-open：返回 null 让请求照常执行。
 */

/** attach 跟尾轮询参数（对齐 CCHP tail：起步小步长，指数上限） */
const ATTACH_POLL_INITIAL_MS = 25;
const ATTACH_POLL_MAX_MS = 200;
/** owner 心跳超过该时长且无新块 -> 判定 owner 失联，跟尾优雅收尾 */
const ATTACH_STALL_MS = 30_000;
/** attach 等待 meta / 尾部数据的总预算（防御性上限，正常流远短于此） */
const ATTACH_MAX_WAIT_MS = 10 * 60 * 1000;

export class ProxyReplayGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    try {
      const identity = deriveReplayIdentity(session);
      if (!identity) return null;

      const env = getEnvConfig();
      const store = getReplayStore();
      const bypassAttach = session.headers.get(REPLAY_BYPASS_HEADER) === "1";

      if (bypassAttach) {
        // 有意重复采样：跳过 attach，但已完成条目不可被覆写——
        // 不 claim、照常执行，条目保留给其他客户端
        const meta = await store.getMeta(identity.replayId);
        if (meta?.status === "completed" && meta.verifier === identity.verifier) {
          return null;
        }
      } else {
        const served = await ProxyReplayGuard.tryServe(session, identity, store, env);
        if (served) return served;
      }

      // 未命中可服务条目：尝试成为 owner（跨副本 single-flight）
      const ownerToken = randomUUID();
      const claimed = await store.tryClaimOwner(identity.replayId, ownerToken);
      if (claimed) {
        // 清掉上一 owner 异常退出遗留的旧 LIST 残块，防止与新流拼接
        await store.deleteChunks(identity.replayId);
        session.replayState = { identity, ownerToken, role: "owner" };
      }
      // claim 失败：竞态输掉且（去重关闭/绕过/不可 attach）——照常执行，无 replay 角色
      return null;
    } catch (error) {
      logger.warn("[ReplayGuard] ensure failed, proceeding without replay", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async tryServe(
    session: ProxySession,
    identity: ReplayIdentity,
    store: ReplayStore,
    env: ReturnType<typeof getEnvConfig>
  ): Promise<Response | null> {
    const meta = await store.getMeta(identity.replayId);

    if (meta) {
      if (meta.verifier !== identity.verifier) {
        // 哈希碰撞：绝不错发他人响应
        logger.warn("[ReplayGuard] verifier mismatch (hash collision), skipping replay", {
          replayId: identity.replayId.slice(0, 12),
        });
        return null;
      }
      if (meta.status === "completed") {
        const chunks = await store.readChunks(identity.replayId, 0);
        if (chunks && chunks.length > 0) {
          await ProxyReplayGuard.writeAuditRow(
            session,
            identity,
            meta.statusCode,
            "redis_completed"
          );
          return ProxyReplayGuard.buildStaticResponse(meta, chunks.join(""));
        }
        // 热层块已过期：落 PG
      } else if (meta.status === "owning") {
        const heartbeatFresh = Date.now() - meta.heartbeatAt < ATTACH_STALL_MS;
        if (env.REPLAY_LIVE_DEDUP_ENABLED && heartbeatFresh) {
          await ProxyReplayGuard.writeAuditRow(session, identity, meta.statusCode, "attached_live");
          return ProxyReplayGuard.buildLiveAttachResponse(identity, meta, store);
        }
        // 心跳过期（owner 崩溃/停机）：不 attach 半截死流；owner 租约到期后可被重新 claim
        return null;
      } else {
        // aborted：终态失败条目不可重放
        return null;
      }
    }

    // Redis miss：查 PG 完成持久层（跨小时/跨副本/跨滚动发布）
    const persisted = await store.findCompleted(identity.replayId);
    if (persisted && persisted.verifier === identity.verifier && persisted.payload.length > 0) {
      await ProxyReplayGuard.writeAuditRow(session, identity, persisted.statusCode, "pg_completed");
      return ProxyReplayGuard.buildStaticResponse(
        {
          statusCode: persisted.statusCode,
          headers: persisted.headersJson ?? { "content-type": "text/event-stream" },
        },
        persisted.payload
      );
    }
    return null;
  }

  /** 已完成条目的全量重放。 */
  private static buildStaticResponse(
    meta: Pick<ReplayMeta, "statusCode" | "headers">,
    payload: string
  ): Response {
    const headers = ProxyReplayGuard.buildServeHeaders(meta.headers, "completed");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    });
    return new Response(body, { status: meta.statusCode || 200, headers });
  }

  /**
   * attach-live：先吐已缓存前缀，然后轮询 LIST 跟实时尾部直到 completed/aborted/stall。
   * 订阅者断开只影响自身（cancel 时停止轮询），对 owner 零影响。
   */
  private static buildLiveAttachResponse(
    identity: ReplayIdentity,
    initialMeta: ReplayMeta,
    store: ReplayStore
  ): Response {
    const headers = ProxyReplayGuard.buildServeHeaders(initialMeta.headers, "live");
    const encoder = new TextEncoder();
    let offset = 0;
    let cancelled = false;
    let pollDelay = ATTACH_POLL_INITIAL_MS;
    const startedAt = Date.now();
    let lastProgressAt = Date.now();

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancelled) {
          const chunks = await store.readChunks(identity.replayId, offset);
          if (chunks === null) {
            // Redis 失联：无法继续跟尾，按传输错误终止
            controller.error(new Error("replay attach lost redis connection"));
            return;
          }
          if (chunks.length > 0) {
            offset += chunks.length;
            lastProgressAt = Date.now();
            pollDelay = ATTACH_POLL_INITIAL_MS;
            controller.enqueue(encoder.encode(chunks.join("")));
            return;
          }

          const meta = await store.getMeta(identity.replayId);
          if (!meta || meta.status === "aborted") {
            controller.error(new Error("replay source aborted"));
            return;
          }
          if (meta.status === "completed") {
            // 终态后补读一次尾部，防 completed 与最后一批块之间的竞态
            const tail = await store.readChunks(identity.replayId, offset);
            if (tail && tail.length > 0) {
              offset += tail.length;
              controller.enqueue(encoder.encode(tail.join("")));
              return;
            }
            controller.close();
            return;
          }
          // owning：stall 检测（owner 心跳 + 本地进度双重判定）
          const now = Date.now();
          if (now - lastProgressAt > ATTACH_STALL_MS && now - meta.heartbeatAt > ATTACH_STALL_MS) {
            controller.error(new Error("replay owner stalled"));
            return;
          }
          if (now - startedAt > ATTACH_MAX_WAIT_MS) {
            controller.error(new Error("replay attach exceeded max wait"));
            return;
          }
          await sleep(pollDelay);
          pollDelay = Math.min(pollDelay * 2, ATTACH_POLL_MAX_MS);
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, { status: initialMeta.statusCode || 200, headers });
  }

  private static buildServeHeaders(
    stored: Record<string, string>,
    mode: "completed" | "live"
  ): Headers {
    const headers = new Headers();
    headers.set("content-type", stored["content-type"] ?? "text/event-stream");
    headers.set("cache-control", "no-cache");
    headers.set("x-cch-replay", mode);
    return headers;
  }

  /** 审计行：costUsd 0、blockedBy replay_serve；不写 usageLedger、不绑 session/亲和。 */
  private static async writeAuditRow(
    session: ProxySession,
    identity: ReplayIdentity,
    statusCode: number,
    source: string
  ): Promise<void> {
    try {
      if (!session.authState?.user || !session.authState.apiKey) return;
      await db.insert(messageRequest).values({
        providerId: 0,
        userId: session.authState.user.id,
        key: session.authState.apiKey,
        model: session.request.model ?? undefined,
        sessionId: session.sessionId ?? undefined,
        statusCode: statusCode || 200,
        costUsd: "0",
        blockedBy: "replay_serve",
        blockedReason: JSON.stringify({
          source,
          replayId: identity.replayId.slice(0, 12),
        }),
        endpoint: identity.endpoint,
        messagesCount: session.getMessagesLength(),
        userAgent: session.userAgent ?? undefined,
      });
    } catch (error) {
      logger.warn("[ReplayGuard] audit row insert failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
