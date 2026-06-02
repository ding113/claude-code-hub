/**
 * 进程级崩溃处理器使用的“良性断管/客户端断连”判定。
 *
 * 背景（issue #1234）：CCH 代理流式响应（如 Codex `/v1/responses`）时，下游客户端在
 * Next.js 仍向 socket 写入时断开，底层 socket write 抛出 `write EPIPE`。该错误发生在
 * 本地 try/catch 之外（最终 Response 写入由 Next.js 持有），逃逸到进程级 uncaughtException
 * 处理器；若按致命错误 process.exit(1)，会把单个请求的断管放大为整个容器重启。
 *
 * 判定范围刻意仅限 EPIPE：
 * - EPIPE 是“写侧”错误——只在“我们向已关闭的 socket 写入”时出现。代理中唯一未被本地
 *   handler 兜住、且会逃逸到进程级的大写入路径，就是 Next.js 向客户端写流式响应；因此
 *   进程级的 EPIPE 几乎必然来自下游断连，抑制它是安全的。
 * - 不包含 ECONNRESET / ERR_STREAM_PREMATURE_CLOSE：这两者方向不确定，可能源自上游
 *   provider / DB / Redis 等连接（读侧重置 / 提前关闭），而进程级处理器没有请求或连接
 *   上下文来区分“客户端断连”与“自身基础设施故障”。全局吞掉它们会把真正的故障降级为
 *   warn 并让进程带病运行，破坏 #1147 引入的 fail-fast 语义。这类码在有上下文的代理层
 *   （forwarder 的 stream error / isTransportError）单独处理。
 *
 * 设计约束：保持零依赖，避免在崩溃处理路径引入副作用导入。
 */

/** 进程级可安全抑制的断管错误码（仅写侧、来源明确的 EPIPE）。 */
const BENIGN_BROKEN_PIPE_CODES = new Set<string>(["EPIPE"]);

/** cause 链最大遍历深度，避免循环引用导致的死循环。 */
const MAX_CAUSE_DEPTH = 5;

/**
 * 返回触发“良性断管”判定的错误码（沿 `cause` 链向下查找），未命中返回 undefined。
 *
 * 供崩溃处理器记录“实际命中的 code”——即便它嵌套在 cause 链深处（undici/fetch 常把底层
 * socket 错误包在 cause 上），也能拿到准确的 code 而非顶层的 undefined。
 *
 * 仅基于错误码（`code`）判定，刻意不做 message 模糊匹配，避免把携带 "EPIPE" 字样的上游
 * 错误文案误判为良性，从而错误地抑制真正应当退出的崩溃。
 *
 * @param err - 待检查的错误（任意类型）
 * @returns 命中的良性错误码；未命中返回 undefined
 */
export function getBenignBrokenPipeCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && BENIGN_BROKEN_PIPE_CODES.has(code)) {
        return code;
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return undefined;
}

/**
 * 是否为“良性的断管/客户端断连”错误（仅 EPIPE，含 cause 链）。
 *
 * @param err - 待检查的错误（任意类型）
 * @returns 命中良性断管错误码时返回 true
 */
export function isBenignBrokenPipeError(err: unknown): boolean {
  return getBenignBrokenPipeCode(err) !== undefined;
}
