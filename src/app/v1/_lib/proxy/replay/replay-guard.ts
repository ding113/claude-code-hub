import { randomUUID } from "node:crypto";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { getProxyRuntimeSettings } from "@/lib/system-settings/proxy-runtime";
import { materializeReplayAuditFromSource } from "@/repository/message";
import type { ProxySession } from "../session";
import { restoreReplayResponseHeaders } from "./replay-headers";
import { deriveReplayIdentity, REPLAY_BYPASS_HEADER, type ReplayIdentity } from "./replay-identity";
import {
  getReplayStore,
  type ReplayMeta,
  type ReplayStore,
  resolveReplayTtlSeconds,
} from "./replay-store";
import { splitAtSafeTextBoundary } from "./replay-text";

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
/** 每次只从 Redis 拉取一页，避免慢客户端把完整 Replay 同时搬进 Node 堆。 */
const REPLAY_SERVE_BATCH_CHUNKS = 64;
/** 单次编码片段上限；同时避免大字符串再生成一份同等大小的 Uint8Array。 */
const REPLAY_ENCODE_SLICE_CHARACTERS = 64 * 1024;

export class ProxyReplayGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    try {
      // guard 位于 provider 步骤之前：先刷新运行时覆写快照，管理端刚保存的
      // replayEnabled 首个请求即生效（底层系统设置缓存有 TTL，常态为缓存命中）
      await getProxyRuntimeSettings();
      const identity = deriveReplayIdentity(session);
      if (!identity) return null;

      const env = getEnvConfig();
      const store = getReplayStore();
      const bypassAttach = session.headers.get(REPLAY_BYPASS_HEADER) === "1";
      let meta: ReplayMeta | null;

      if (bypassAttach) {
        // 有意重复采样：跳过 attach，但已完成条目不可被覆写——
        // 不 claim、照常执行，条目保留给其他客户端
        meta = await store.getMeta(identity.replayId);
        if (meta?.status === "completed" && meta.verifier === identity.verifier) {
          return null;
        }
      } else {
        meta = await store.getMeta(identity.replayId);
        const served = await ProxyReplayGuard.tryServeRedis(session, identity, meta, store, env);
        if (served) return served;
      }

      // 未命中 Redis 可服务条目：先抢跨副本 owner，再查一次 PG。旧 owner 必须先
      // 完成 PG 写入才会释放租约，因此该顺序既消除“PG miss 后旧 owner 才提交”
      // 的竞态，也让每个 miss 仍只做一次 PG 查询。
      const ownerToken = randomUUID();
      const claimed = await store.tryClaimOwner(identity.replayId, ownerToken);
      // 活跃 owner 已经通过 meta 给出了明确结果；竞争请求不再额外打 PG。
      if (!claimed && meta?.status === "owning") return null;

      let persisted: Awaited<ReturnType<ReplayStore["findCompleted"]>>;
      try {
        persisted = await store.findCompleted(identity.replayId);
      } catch (error) {
        if (claimed) await store.releaseOwner(identity.replayId, ownerToken);
        throw error;
      }

      if (persisted) {
        if (claimed) await store.releaseOwner(identity.replayId, ownerToken);
        // bypass 只要求本次不复用；已有 durable winner 仍必须受保护，不能让
        // 新 owner 覆写热层后在 live attach 中与旧正文混合。
        if (bypassAttach) return null;
        if (persisted.verifier !== identity.verifier || persisted.payload.length === 0) {
          return null;
        }
        await ProxyReplayGuard.writeAuditRow(
          session,
          identity,
          persisted.statusCode,
          "pg_completed",
          persisted.sourceMessageRequestId
        );
        return ProxyReplayGuard.buildStaticResponse(
          {
            statusCode: persisted.statusCode,
            headers: persisted.headersJson ?? { "content-type": "text/event-stream" },
          },
          persisted.payload
        );
      }

      if (claimed) {
        // PG 查询期间租约可能过期并被接管；清旧热层与续租必须受 token fencing。
        // 只有原子准备仍成功时才把本请求挂成 owner。
        const prepared = await store.prepareOwned(identity.replayId, ownerToken);
        if (prepared) session.replayState = { identity, ownerToken, role: "owner" };
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

  private static async tryServeRedis(
    session: ProxySession,
    identity: ReplayIdentity,
    meta: ReplayMeta | null,
    store: ReplayStore,
    env: ReturnType<typeof getEnvConfig>
  ): Promise<Response | null> {
    if (meta) {
      if (meta.verifier !== identity.verifier) {
        // 哈希碰撞：绝不错发他人响应
        logger.warn("[ReplayGuard] verifier mismatch (hash collision), skipping replay", {
          replayId: identity.replayId.slice(0, 12),
        });
        return null;
      }
      if (meta.status === "completed") {
        const completedMessageRequestId = meta.messageRequestId;
        const expectedChunkCount =
          Number.isSafeInteger(meta.chunkCount) && meta.chunkCount > 0 ? meta.chunkCount : 0;
        // 只把 LIST 续到 Redis 热层原本的固定到期点。持久层可能保留更久，
        // 但不能因为一个慢客户端而绕过 REPLAY_TTL_SECONDS 延长 Redis 占用。
        const completedExpiresAt = meta.heartbeatAt + resolveReplayTtlSeconds() * 1000;
        const remainingTtlSeconds = resolveRemainingTtlSeconds(completedExpiresAt);
        const chunkRead =
          completedMessageRequestId != null && expectedChunkCount > 0 && remainingTtlSeconds > 0
            ? await store.readChunksForGeneration(
                identity.replayId,
                completedMessageRequestId,
                0,
                Math.min(REPLAY_SERVE_BATCH_CHUNKS, expectedChunkCount),
                remainingTtlSeconds
              )
            : [];
        if (chunkRead === false) {
          logger.warn("[ReplayGuard] completed replay generation changed before delivery", {
            replayId: identity.replayId.slice(0, 12),
            messageRequestId: completedMessageRequestId,
          });
          return null;
        }
        const chunks: string[] | null = chunkRead;
        if (chunks && chunks.length > 0) {
          await ProxyReplayGuard.writeAuditRow(
            session,
            identity,
            meta.statusCode,
            "redis_completed",
            meta.messageRequestId
          );
          return ProxyReplayGuard.buildRedisCompletedResponse(
            meta,
            identity.replayId,
            identity.verifier,
            completedMessageRequestId as number,
            store,
            chunks,
            expectedChunkCount,
            completedExpiresAt
          );
        }
        // 热层块已过期：落 PG
      } else if (meta.status === "owning") {
        const heartbeatFresh = Date.now() - meta.heartbeatAt < ATTACH_STALL_MS;
        if (
          meta.delivery !== "buffered" &&
          meta.messageRequestId != null &&
          env.REPLAY_LIVE_DEDUP_ENABLED &&
          heartbeatFresh
        ) {
          return ProxyReplayGuard.buildLiveAttachResponse(
            session,
            identity,
            meta,
            meta.messageRequestId,
            store
          );
        }
        // 心跳过期（owner 崩溃/停机）：不 attach 半截死流；owner 租约到期后可被重新 claim
        return null;
      } else {
        // aborted：终态失败条目不可重放
        return null;
      }
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
    const cursor = createTextCursor([payload]);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!enqueueNextTextSlice(controller, cursor, encoder)) controller.close();
      },
      cancel() {
        clearTextCursor(cursor);
      },
    });
    return new Response(body, { status: meta.statusCode || 200, headers });
  }

  /** Redis completed 条目按页、按下游 pull 读取，避免完整 chunks + join + encode 三份峰值。 */
  private static buildRedisCompletedResponse(
    meta: Pick<ReplayMeta, "statusCode" | "headers">,
    replayId: string,
    verifier: string,
    completedMessageRequestId: number,
    store: ReplayStore,
    initialChunks: string[],
    expectedChunkCount: number,
    completedExpiresAt: number
  ): Response {
    const headers = ProxyReplayGuard.buildServeHeaders(meta.headers, "completed");
    const encoder = new TextEncoder();
    const cursor = createTextCursor(initialChunks);
    let offset = initialChunks.length;
    let reachedEnd = offset >= expectedChunkCount;
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancelled) {
          if (enqueueNextTextSlice(controller, cursor, encoder)) return;
          if (reachedEnd) {
            controller.close();
            return;
          }

          const remainingTtlSeconds = resolveRemainingTtlSeconds(completedExpiresAt);
          const chunkRead =
            remainingTtlSeconds > 0
              ? await store.readChunksForGeneration(
                  replayId,
                  completedMessageRequestId,
                  offset,
                  Math.min(REPLAY_SERVE_BATCH_CHUNKS, expectedChunkCount - offset),
                  remainingTtlSeconds
                )
              : [];
          if (cancelled) return;
          if (chunkRead === false) {
            clearTextCursor(cursor);
            controller.error(new Error("replay completed generation changed"));
            return;
          }
          const chunks: string[] | null = chunkRead;
          if (chunks === null || chunks.length === 0) {
            // completed 条目已经在 PG 通过终态屏障持久化；Redis LIST 可能在
            // 慢客户端暂停期间过期。用已发送的字符偏移从 durable payload 续传，
            // 避免把热层 TTL 过期暴露成截断响应。
            let durable: Awaited<ReturnType<ReplayStore["findCompleted"]>>;
            try {
              durable = await store.findCompleted(replayId);
            } catch (error) {
              clearTextCursor(cursor);
              controller.error(error);
              return;
            }
            if (cancelled) return;
            if (
              durable?.verifier === verifier &&
              durable.sourceMessageRequestId === completedMessageRequestId &&
              cursor.totalCharactersEmitted < durable.payload.length
            ) {
              replaceTextCursorChunkAtOffset(
                cursor,
                durable.payload,
                cursor.totalCharactersEmitted
              );
              reachedEnd = true;
              continue;
            }
            logger.warn("[ReplayGuard] completed replay continuation unavailable", {
              replayId: replayId.slice(0, 12),
              offset,
              expectedChunkCount,
              redisResult: chunks === null ? "unavailable" : "truncated",
              durableResult: durable
                ? durable.verifier === verifier
                  ? durable.sourceMessageRequestId === completedMessageRequestId
                    ? "shorter_than_emitted_prefix"
                    : "owner_generation_mismatch"
                  : "verifier_mismatch"
                : "unavailable",
            });
            clearTextCursor(cursor);
            controller.error(
              new Error(
                chunks === null
                  ? "replay completed payload became unavailable"
                  : "replay completed payload was truncated"
              )
            );
            return;
          }
          offset += chunks.length;
          if (offset > expectedChunkCount) {
            logger.warn("[ReplayGuard] completed replay exceeded metadata", {
              replayId: replayId.slice(0, 12),
              offset,
              expectedChunkCount,
            });
            clearTextCursor(cursor);
            controller.error(new Error("replay completed payload exceeded metadata"));
            return;
          }
          reachedEnd = offset >= expectedChunkCount;
          replaceTextCursorChunks(cursor, chunks);
        }
      },
      cancel() {
        cancelled = true;
        clearTextCursor(cursor);
      },
    });
    return new Response(body, { status: meta.statusCode || 200, headers });
  }

  /**
   * attach-live：先吐已缓存前缀，然后轮询 LIST 跟实时尾部直到 completed/aborted/stall。
   * 订阅者断开只影响自身（cancel 时停止轮询），对 owner 零影响。
   */
  private static buildLiveAttachResponse(
    session: ProxySession,
    identity: ReplayIdentity,
    initialMeta: ReplayMeta,
    ownerMessageRequestId: number,
    store: ReplayStore
  ): Response {
    const headers = ProxyReplayGuard.buildServeHeaders(initialMeta.headers, "live");
    const encoder = new TextEncoder();
    let offset = 0;
    const cancellation = new AbortController();
    const cursor = createTextCursor([]);
    let pollDelay = ATTACH_POLL_INITIAL_MS;
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    let completedMeta: ReplayMeta | null = null;
    let completedExpiresAt: number | null = null;
    let durableCompletion: { statusCode: number; messageRequestId: number | null } | null = null;
    // cancel 时主动断开对完整 ProxySession 的引用；只在本订阅者真正读完整条目后写审计。
    let auditSession: ProxySession | null = session;

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancellation.signal.aborted) {
          if (enqueueNextTextSlice(controller, cursor, encoder)) return;
          if (durableCompletion) {
            const completedSession = auditSession;
            auditSession = null;
            controller.close();
            if (completedSession && durableCompletion.messageRequestId) {
              void ProxyReplayGuard.writeAuditRow(
                completedSession,
                identity,
                durableCompletion.statusCode,
                "attached_live",
                durableCompletion.messageRequestId
              );
            }
            return;
          }

          let maxChunks = REPLAY_SERVE_BATCH_CHUNKS;
          if (completedMeta) {
            const expectedChunkCount = completedMeta.chunkCount;
            if (!Number.isSafeInteger(expectedChunkCount) || expectedChunkCount < 0) {
              auditSession = null;
              controller.error(new Error("replay completed metadata is invalid"));
              return;
            }
            if (offset > expectedChunkCount) {
              auditSession = null;
              controller.error(new Error("replay live payload exceeded metadata"));
              return;
            }
            if (offset === expectedChunkCount) {
              const completedSession = auditSession;
              auditSession = null;
              controller.close();
              if (completedSession && completedMeta.messageRequestId) {
                void ProxyReplayGuard.writeAuditRow(
                  completedSession,
                  identity,
                  completedMeta.statusCode,
                  "attached_live",
                  completedMeta.messageRequestId
                );
              }
              return;
            }
            maxChunks = Math.min(REPLAY_SERVE_BATCH_CHUNKS, expectedChunkCount - offset);
          }

          const remainingTtlSeconds =
            completedExpiresAt === null ? null : resolveRemainingTtlSeconds(completedExpiresAt);
          const chunkRead =
            remainingTtlSeconds === 0
              ? []
              : await store.readChunksForGeneration(
                  identity.replayId,
                  ownerMessageRequestId,
                  offset,
                  maxChunks,
                  completedMeta && remainingTtlSeconds !== null ? remainingTtlSeconds : undefined
                );
          if (chunkRead === false) {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay owner generation changed"));
            return;
          }
          const chunks: string[] | null = chunkRead;
          if (cancellation.signal.aborted) return;
          if (completedMeta && (chunks === null || chunks.length === 0)) {
            // attach 可能在 owner 完成后被慢客户端暂停到热层过期。completed 已经过
            // PG 终态屏障，因此可按已发送字符数从 durable payload 无缝接续。
            let durable: Awaited<ReturnType<ReplayStore["findCompleted"]>>;
            try {
              durable = await store.findCompleted(identity.replayId);
            } catch (error) {
              auditSession = null;
              clearTextCursor(cursor);
              controller.error(error);
              return;
            }
            if (cancellation.signal.aborted) return;
            if (
              durable?.verifier === identity.verifier &&
              durable.sourceMessageRequestId === ownerMessageRequestId &&
              cursor.totalCharactersEmitted < durable.payload.length
            ) {
              replaceTextCursorChunkAtOffset(
                cursor,
                durable.payload,
                cursor.totalCharactersEmitted
              );
              offset = completedMeta.chunkCount;
              continue;
            }
            logger.warn("[ReplayGuard] live replay continuation unavailable", {
              replayId: identity.replayId.slice(0, 12),
              offset,
              expectedChunkCount: completedMeta.chunkCount,
              redisResult: chunks === null ? "unavailable" : "truncated",
              durableResult: durable
                ? durable.verifier === identity.verifier
                  ? durable.sourceMessageRequestId === ownerMessageRequestId
                    ? "shorter_than_emitted_prefix"
                    : "owner_generation_mismatch"
                  : "verifier_mismatch"
                : "unavailable",
            });
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay live payload was truncated"));
            return;
          }
          if (chunks === null) {
            // Redis 失联：无法继续跟尾，按传输错误终止
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay attach lost redis connection"));
            return;
          }
          if (chunks.length > 0) {
            offset += chunks.length;
            lastProgressAt = Date.now();
            pollDelay = ATTACH_POLL_INITIAL_MS;
            replaceTextCursorChunks(cursor, chunks);
            continue;
          }

          const meta = await store.getMeta(identity.replayId);
          if (cancellation.signal.aborted) return;
          if (!meta) {
            // owner 先把完整响应持久化到 PG，再翻转 completed meta。慢客户端
            // 可能恰好在 meta/LIST 同时到期后才轮询；此时按已发送字符精确续传。
            let durable: Awaited<ReturnType<ReplayStore["findCompleted"]>>;
            try {
              durable = await store.findCompleted(identity.replayId);
            } catch (error) {
              auditSession = null;
              clearTextCursor(cursor);
              controller.error(error);
              return;
            }
            if (cancellation.signal.aborted) return;
            if (
              ownerMessageRequestId !== null &&
              durable?.verifier === identity.verifier &&
              durable.sourceMessageRequestId === ownerMessageRequestId &&
              durable.payload.length > 0 &&
              cursor.totalCharactersEmitted <= durable.payload.length
            ) {
              replaceTextCursorChunkAtOffset(
                cursor,
                durable.payload,
                cursor.totalCharactersEmitted
              );
              durableCompletion = {
                statusCode: durable.statusCode,
                messageRequestId: durable.sourceMessageRequestId,
              };
              continue;
            }
            logger.warn("[ReplayGuard] live replay terminal metadata unavailable", {
              replayId: identity.replayId.slice(0, 12),
              offset,
              emittedCharacters: cursor.totalCharactersEmitted,
              durableResult: durable
                ? durable.verifier === identity.verifier
                  ? durable.sourceMessageRequestId === ownerMessageRequestId
                    ? "shorter_than_emitted_prefix"
                    : "owner_generation_mismatch"
                  : "verifier_mismatch"
                : "unavailable",
            });
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay source aborted"));
            return;
          }
          if (meta.status === "aborted") {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay source aborted"));
            return;
          }
          if (ownerMessageRequestId !== null && meta.messageRequestId !== ownerMessageRequestId) {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay owner generation changed"));
            return;
          }
          if (meta.status === "completed") {
            // completed 与最后一批块可能先后可见；下一轮仍从当前 offset 补读到空。
            completedMeta = meta;
            completedExpiresAt = meta.heartbeatAt + resolveReplayTtlSeconds() * 1000;
            continue;
          }
          // owning：stall 检测（owner 心跳 + 本地进度双重判定）
          const now = Date.now();
          if (now - lastProgressAt > ATTACH_STALL_MS && now - meta.heartbeatAt > ATTACH_STALL_MS) {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay owner stalled"));
            return;
          }
          if (now - startedAt > ATTACH_MAX_WAIT_MS) {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay attach exceeded max wait"));
            return;
          }
          const elapsed = await sleep(pollDelay, cancellation.signal);
          if (!elapsed) return;
          pollDelay = Math.min(pollDelay * 2, ATTACH_POLL_MAX_MS);
        }
      },
      cancel() {
        auditSession = null;
        clearTextCursor(cursor);
        cancellation.abort();
      },
    });
    return new Response(body, { status: initialMeta.statusCode || 200, headers });
  }

  private static buildServeHeaders(
    stored: Record<string, string>,
    mode: "completed" | "live"
  ): Headers {
    const headers = restoreReplayResponseHeaders(stored);
    const contentType = headers.get("content-type")?.toLowerCase() ?? "";
    if (mode === "live" && !contentType) {
      headers.set("content-type", "text/event-stream");
    }
    if (mode === "live" || contentType.includes("text/event-stream")) {
      headers.set("cache-control", "no-cache");
    }
    headers.set("x-cch-replay", mode);
    return headers;
  }

  /** 审计行：保留 Replay provenance 与 usage 投影，costUsd 恒为 0。 */
  private static async writeAuditRow(
    session: ProxySession,
    identity: ReplayIdentity,
    statusCode: number,
    source: string,
    sourceRequestId?: number | null
  ): Promise<number | null> {
    try {
      if (!session.authState?.user || !session.authState.apiKey) return null;
      const sessionIdentity = session.getSessionIdentityMetadata();
      const [auditRow] = await db
        .insert(messageRequest)
        .values({
          providerId: 0,
          userId: session.authState.user.id,
          key: session.authState.apiKey,
          model: session.request.model ?? undefined,
          sessionId: session.sessionId ?? undefined,
          sessionIdentity: sessionIdentity.identity || session.sessionId || undefined,
          sessionIdentityKind: sessionIdentity.kind,
          affinityScopeTag: sessionIdentity.scopeTag,
          affinityFingerprint: sessionIdentity.fingerprint,
          affinityFingerprintChain: sessionIdentity.fingerprints,
          requestSequence: session.requestSequence,
          statusCode: statusCode || 200,
          costUsd: "0",
          blockedBy: null,
          isReplay: true,
          replaySourceRequestId: sourceRequestId,
          blockedReason: JSON.stringify({
            source,
            sourceRequestId: sourceRequestId ?? null,
            replayId: identity.replayId.slice(0, 12),
          }),
          endpoint: identity.endpoint,
          messagesCount: session.getMessagesLength(),
          userAgent: session.userAgent ?? undefined,
        })
        .returning({ id: messageRequest.id });

      if (auditRow && sourceRequestId) {
        await ProxyReplayGuard.tryMaterializeAudit(auditRow.id, sourceRequestId);
      }
      return auditRow?.id ?? null;
    } catch (error) {
      logger.warn("[ReplayGuard] audit row insert failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async tryMaterializeAudit(
    replayRequestId: number,
    sourceRequestId: number
  ): Promise<void> {
    try {
      await materializeReplayAuditFromSource(replayRequestId, sourceRequestId);
    } catch (error) {
      logger.warn("[ReplayGuard] audit materialization failed", {
        replayRequestId,
        sourceRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

interface TextCursor {
  chunks: string[];
  chunkIndex: number;
  characterOffset: number;
  totalCharactersEmitted: number;
}

function createTextCursor(chunks: string[]): TextCursor {
  return { chunks, chunkIndex: 0, characterOffset: 0, totalCharactersEmitted: 0 };
}

function replaceTextCursorChunks(cursor: TextCursor, chunks: string[]): void {
  cursor.chunks = chunks;
  cursor.chunkIndex = 0;
  cursor.characterOffset = 0;
}

/** 切换到 durable payload 的既有偏移，不复制可能很大的剩余字符串。 */
function replaceTextCursorChunkAtOffset(
  cursor: TextCursor,
  chunk: string,
  characterOffset: number
): void {
  cursor.chunks = [chunk];
  cursor.chunkIndex = 0;
  cursor.characterOffset = characterOffset;
}

function clearTextCursor(cursor: TextCursor): void {
  replaceTextCursorChunks(cursor, []);
}

/** completed 分页只能保留到完成时确定的固定到期点，慢客户端读取不得滑动续期。 */
function resolveRemainingTtlSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

/** 每个 pull 最多编码一个有界片段，并保持 UTF-16 代理对完整。 */
function enqueueNextTextSlice(
  controller: ReadableStreamDefaultController<Uint8Array>,
  cursor: TextCursor,
  encoder: TextEncoder
): boolean {
  while (cursor.chunkIndex < cursor.chunks.length) {
    const chunk = cursor.chunks[cursor.chunkIndex];
    if (cursor.characterOffset >= chunk.length) {
      cursor.chunkIndex += 1;
      cursor.characterOffset = 0;
      continue;
    }

    const end = splitAtSafeTextBoundary(
      chunk,
      cursor.characterOffset,
      REPLAY_ENCODE_SLICE_CHARACTERS
    );

    controller.enqueue(encoder.encode(chunk.slice(cursor.characterOffset, end)));
    cursor.totalCharactersEmitted += end - cursor.characterOffset;
    cursor.characterOffset = end;
    return true;
  }

  clearTextCursor(cursor);
  return false;
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
