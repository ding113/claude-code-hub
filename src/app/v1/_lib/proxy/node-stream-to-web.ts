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

  return new ReadableStream<Uint8Array>({
    start(controller) {
      logger.debug("ProxyForwarder: Starting Node-to-Web stream conversion", {
        providerId,
        providerName,
      });

      onData = (chunk: Buffer | Uint8Array) => {
        if (settled) return;
        chunkCount++;
        totalBytes += chunk.length;
        try {
          const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          controller.enqueue(buf);
        } catch {
          // controller 已关闭/出错时忽略
        }
      };
      nodeStream.on("data", onData);

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
    },

    cancel(reason) {
      settled = true;
      detach(nodeStream);
      if (!nodeStream.destroyed) {
        // destroy(reason) 会 re-emit "error"，而我们已经 detach 了错误监听。
        // 留一个 no-op 监听吞掉它，避免 native EventEmitter 触发 uncaughtException。
        nodeStream.once("error", () => {
          // ignore: web 流已 cancel，下游没有 reader 关心了
        });
        try {
          nodeStream.destroy(
            reason instanceof Error ? reason : reason ? new Error(String(reason)) : undefined
          );
        } catch {
          // ignore
        }
      }
    },
  });
}
