import type { Readable } from "node:stream";
import { logger } from "@/lib/logger";

/**
 * 将 Node.js Readable 流转换为 Web ReadableStream（容错版本）
 *
 * 关键不变量（issue #1147 修复）：
 * - close()/error() 在 Web 流侧最多触发一次（settled 单触发标志）
 * - 任一终态触发后立即移除 nodeStream 上的所有监听器，确保 destroy() 引发的
 *   后续事件不会再访问 controller，从而消除"半释放 native 流上的回调"导致的
 *   段错误窗口
 * - cancel() 在调用 destroy() 之前先 detach 监听器，再检查 destroyed 防止
 *   重复 destroy
 */
export function nodeStreamToWebStreamSafe(
  nodeStream: Readable,
  providerId: number,
  providerName: string
): ReadableStream<Uint8Array> {
  let chunkCount = 0;
  let totalBytes = 0;
  let settled = false;

  let onData: ((chunk: Buffer | Uint8Array) => void) | null = null;
  let onEnd: (() => void) | null = null;
  let onClose: (() => void) | null = null;
  let onError: ((err: Error) => void) | null = null;

  const detach = (stream: Readable) => {
    if (onData) stream.removeListener("data", onData);
    if (onEnd) stream.removeListener("end", onEnd);
    if (onClose) stream.removeListener("close", onClose);
    if (onError) stream.removeListener("error", onError);
    onData = null;
    onEnd = null;
    onClose = null;
    onError = null;
  };

  const installPendingDestroyErrorGuard = (stream: Readable) => {
    let cleanupTimeout: NodeJS.Timeout | null = null;
    const cleanup = () => {
      stream.removeListener("error", swallow);
      stream.removeListener("close", cleanup);
      if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
      }
    };
    const swallow = () => {
      // ignore: the Web stream has already settled with the same terminal state
      cleanup();
    };

    stream.once("error", swallow);
    stream.once("close", cleanup);
    cleanupTimeout = setTimeout(cleanup, 60_000);
    cleanupTimeout.unref?.();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        logger.debug("ProxyForwarder: Starting Node-to-Web stream conversion", {
          providerId,
          providerName,
        });

        // Web ReadableStream 通过 pull() 表达下游需求。先保持 Node 流暂停，
        // 并在注册会启用 flowing mode 的 data 监听器前安装所有终态监听器。
        nodeStream.pause();

        onEnd = () => {
          if (settled) return;
          settled = true;
          logger.debug("ProxyForwarder: Node stream ended normally", {
            providerId,
            providerName,
            chunkCount,
            totalBytes,
          });
          detach(nodeStream);
          try {
            controller.close();
          } catch {
            // ignore
          }
        };
        nodeStream.on("end", onEnd);

        onClose = () => {
          if (settled) return;
          if (!nodeStream.readableEnded) {
            onError?.(new Error("Upstream stream closed before end"));
            return;
          }
          settled = true;
          logger.debug("ProxyForwarder: Node stream closed", {
            providerId,
            providerName,
            chunkCount,
            totalBytes,
          });
          detach(nodeStream);
          try {
            controller.close();
          } catch {
            // ignore
          }
        };
        nodeStream.on("close", onClose);

        onError = (err: Error) => {
          if (settled) return;
          settled = true;
          logger.warn("ProxyForwarder: Upstream stream error (signaling downstream)", {
            providerId,
            providerName,
            error: err.message,
            errorName: err.name,
          });
          detach(nodeStream);
          try {
            controller.error(err);
          } catch {
            // ignore
          }
        };
        nodeStream.on("error", onError);

        onData = (chunk: Buffer | Uint8Array) => {
          if (settled) return;
          chunkCount++;
          totalBytes += chunk.length;
          try {
            const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            controller.enqueue(buf);
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              nodeStream.pause();
            }
          } catch {
            // controller 已关闭/出错时忽略
          }
        };
        nodeStream.on("data", onData);

        const preexistingError = nodeStream.errored;
        if (preexistingError) {
          // Before close, destroy(error) may have recorded the error while its
          // event is still queued. Once close has fired, no delayed destroy event
          // remains and retaining the bounded guard would only hold the stream.
          if (!nodeStream.closed) {
            installPendingDestroyErrorGuard(nodeStream);
          }
          onError(preexistingError);
          return;
        }

        if (nodeStream.readableAborted || (nodeStream.closed && !nodeStream.readableEnded)) {
          if (!nodeStream.closed) {
            // destroy() marks the stream aborted before an asynchronous _destroy
            // callback can emit its error. Keep a bounded listener until that
            // callback reaches error/close so the settled Web stream cannot turn
            // a request-local failure into an uncaught process error.
            installPendingDestroyErrorGuard(nodeStream);
          }
          onError(new Error("Upstream stream closed before end"));
          return;
        }

        // end/close 可能在包装前已经发出；监听器安装完成后复查终态，
        // 避免 Web reader 永久等待一个不会再次触发的事件。
        if (nodeStream.readableEnded) {
          onEnd();
        }
      },

      pull() {
        if (!settled && !nodeStream.destroyed) {
          nodeStream.resume();
        }
      },

      cancel(reason) {
        // 重复 cancel 应是 no-op：避免重复 detach、重复注册 swallow 监听
        if (settled) return;
        settled = true;
        detach(nodeStream);

        if (nodeStream.destroyed) {
          // destroy(error) may queue an error even after closed becomes true.
          // External destroy() can also set destroyed before an asynchronous
          // _destroy callback supplies its error, so guard while close is pending.
          if (nodeStream.errored || !nodeStream.closed) {
            installPendingDestroyErrorGuard(nodeStream);
          }
          return;
        }

        installPendingDestroyErrorGuard(nodeStream);

        try {
          nodeStream.destroy(
            reason instanceof Error ? reason : reason ? new Error(String(reason)) : undefined
          );
        } catch {
          // ignore
        }
      },
    },
    {
      highWaterMark: Math.max(1, nodeStream.readableHighWaterMark * 2),
      size(chunk) {
        return chunk.byteLength;
      },
    }
  );
}
