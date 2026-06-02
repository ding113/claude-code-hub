/**
 * Benign broken-pipe / client-disconnect error detection.
 *
 * 背景（issue #1234）：当 CCH 代理 Codex `/v1/responses` 流式响应时，下游客户端
 * 在 Next.js 仍在向 socket 写入时断开连接，底层 socket write 会抛出 `write EPIPE`。
 * 该错误发生在本地 try/catch 之外（由 Next.js 持有最终 Response 写入），最终逃逸到
 * 进程级 uncaughtException 处理器。若按致命错误处理（process.exit(1)），会把
 * 单个请求的断管放大为整个容器重启。
 *
 * 本模块提供零依赖的判定函数，供进程级崩溃处理器识别这类“良性断连”错误，
 * 仅记录日志而不退出进程。判定范围刻意保持狭窄（仅 socket/stream 断连码），
 * 真正的逻辑错误仍会 fail-fast。
 *
 * 设计约束：保持零依赖，避免在崩溃处理路径引入副作用导入。
 */

/**
 * 良性断连错误码集合。
 *
 * - EPIPE：向已关闭的 socket 写入（下游客户端先断开）。
 * - ECONNRESET：连接被对端重置（客户端/中间代理断连）。
 * - ERR_STREAM_PREMATURE_CLOSE：可读/可写流在结束前被提前关闭（断连的常见包装码）。
 */
const BENIGN_BROKEN_PIPE_CODES = new Set<string>([
  "EPIPE",
  "ECONNRESET",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

/** cause 链最大遍历深度，避免循环引用导致的死循环。 */
const MAX_CAUSE_DEPTH = 5;

/**
 * 判断错误是否为“良性的断管/客户端断连”错误。
 *
 * 仅基于错误码（`code`）判定，并沿 `cause` 链向下检查（undici/fetch 常把底层
 * socket 错误包在 cause 上）。刻意不做宽松的 message 匹配，避免把携带 "EPIPE"/
 * "ECONNRESET" 字样的上游错误文案误判为良性，从而错误地抑制真正应当退出的崩溃。
 *
 * @param err - 待检查的错误（任意类型）
 * @returns 命中良性断连错误码时返回 true
 */
export function isBenignBrokenPipeError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && BENIGN_BROKEN_PIPE_CODES.has(code)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}
