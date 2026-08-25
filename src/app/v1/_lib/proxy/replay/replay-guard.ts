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
        const expectedChunkCount =
          Number.isSafeInteger(meta.chunkCount) && meta.chunkCount > 0 ? meta.chunkCount : 0;
        const chunks =
          expectedChunkCount > 0
            ? await store.readChunks(
                identity.replayId,
                0,
                Math.min(REPLAY_SERVE_BATCH_CHUNKS, expectedChunkCount)
              )
            : null;
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
            store,
            chunks,
            expectedChunkCount
          );
        }
        // 热层块已过期：落 PG
      } else if (meta.status === "owning") {
        const heartbeatFresh = Date.now() - meta.heartbeatAt < ATTACH_STALL_MS;
        if (meta.delivery !== "buffered" && env.REPLAY_LIVE_DEDUP_ENABLED && heartbeatFresh) {
          return ProxyReplayGuard.buildLiveAttachResponse(session, identity, meta, store);
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
    store: ReplayStore,
    initialChunks: string[],
    expectedChunkCount: number
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

          const chunks = await store.readChunks(
            replayId,
            offset,
            Math.min(REPLAY_SERVE_BATCH_CHUNKS, expectedChunkCount - offset)
          );
          if (cancelled) return;
          if (chunks === null) {
            clearTextCursor(cursor);
            controller.error(new Error("replay completed payload became unavailable"));
            return;
          }
          if (chunks.length === 0) {
            clearTextCursor(cursor);
            controller.error(new Error("replay completed payload was truncated"));
            return;
          }
          offset += chunks.length;
          if (offset > expectedChunkCount) {
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
    // cancel 时主动断开对完整 ProxySession 的引用；只在本订阅者真正读完整条目后写审计。
    let auditSession: ProxySession | null = session;

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancellation.signal.aborted) {
          if (enqueueNextTextSlice(controller, cursor, encoder)) return;

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

          const chunks = await store.readChunks(identity.replayId, offset, maxChunks);
          if (cancellation.signal.aborted) return;
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

          if (completedMeta) {
            auditSession = null;
            controller.error(new Error("replay live payload was truncated"));
            return;
          }

          const meta = await store.getMeta(identity.replayId);
          if (cancellation.signal.aborted) return;
          if (!meta || meta.status === "aborted") {
            auditSession = null;
            clearTextCursor(cursor);
            controller.error(new Error("replay source aborted"));
            return;
          }
          if (meta.status === "completed") {
            // completed 与最后一批块可能先后可见；下一轮仍从当前 offset 补读到空。
            completedMeta = meta;
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
}

function createTextCursor(chunks: string[]): TextCursor {
  return { chunks, chunkIndex: 0, characterOffset: 0 };
}

function replaceTextCursorChunks(cursor: TextCursor, chunks: string[]): void {
  cursor.chunks = chunks;
  cursor.chunkIndex = 0;
  cursor.characterOffset = 0;
}

function clearTextCursor(cursor: TextCursor): void {
  replaceTextCursorChunks(cursor, []);
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

    let end = Math.min(chunk.length, cursor.characterOffset + REPLAY_ENCODE_SLICE_CHARACTERS);
    if (end < chunk.length) {
      const previous = chunk.charCodeAt(end - 1);
      const next = chunk.charCodeAt(end);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        end -= 1;
      }
    }

    controller.enqueue(encoder.encode(chunk.slice(cursor.characterOffset, end)));
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
