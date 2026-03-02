export interface CodeDisplayConfig {
  /**
   * 方案1：长内容 Pretty 视图使用纯文本（不做全量语法高亮）。
   *
   * 默认开启（未设置 env 时也视为 true）。
   */
  largePlainEnabled: boolean;

  /**
   * 方案3：仅对可视窗口做语法高亮（虚拟化高亮）。
   *
   * 默认关闭，需要显式开启。
   */
  virtualHighlightEnabled: boolean;

  /**
   * 是否启用 Web Worker（用于格式化/行索引/搜索等重计算）。
   *
   * 默认开启；测试环境可在实现里回落到主线程。
   */
  workerEnabled: boolean;

  /**
   * 性能调试开关：记录格式化/索引/高亮窗口更新等耗时。
   */
  perfDebugEnabled: boolean;

  /**
   * 超过该字符数，禁止使用全量 SyntaxHighlighter 渲染（避免 DOM 爆炸）。
   */
  highlightMaxChars: number;

  /**
   * 虚拟化高亮上下预渲染缓冲行数。
   */
  virtualOverscanLines: number;

  /**
   * 虚拟化高亮固定行高（像素），需配合 CSS 强制 line-height。
   */
  virtualLineHeightPx: number;

  /**
   * 虚拟化高亮的上下文预热行数，用于降低切片高亮的状态丢失风险。
   */
  virtualContextLines: number;

  /**
   * Pretty 输出的最大字节数（估算：按 UTF-16 字符 * 2）。
   * 超过则不生成 pretty（提示下载或回退 raw），避免内存峰值。
   */
  maxPrettyOutputBytes: number;

  /**
   * 允许构建行索引（lineStarts）的最大行数，超过则禁用虚拟化高亮。
   */
  maxLineIndexLines: number;
}

export const DEFAULT_CODE_DISPLAY_CONFIG: CodeDisplayConfig = {
  largePlainEnabled: true,
  virtualHighlightEnabled: false,
  workerEnabled: true,
  perfDebugEnabled: false,
  highlightMaxChars: 30_000,
  virtualOverscanLines: 50,
  virtualLineHeightPx: 18,
  virtualContextLines: 50,
  maxPrettyOutputBytes: 20_000_000,
  maxLineIndexLines: 200_000,
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parseIntEnv(
  value: string | undefined,
  fallback: number,
  opts?: { min?: number; max?: number }
): number {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  const min = opts?.min ?? Number.NEGATIVE_INFINITY;
  const max = opts?.max ?? Number.POSITIVE_INFINITY;

  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 从 env（建议在服务端读取）解析出 CodeDisplayConfig。
 *
 * 注意：此函数不直接依赖 process.env，调用方可传入任意 env 字典，避免在客户端误用。
 */
export function parseCodeDisplayConfigFromEnv(
  env: Record<string, string | undefined>
): CodeDisplayConfig {
  return {
    largePlainEnabled: parseBooleanEnv(
      env.CCH_CODEDISPLAY_LARGE_PLAIN,
      DEFAULT_CODE_DISPLAY_CONFIG.largePlainEnabled
    ),
    virtualHighlightEnabled: parseBooleanEnv(
      env.CCH_CODEDISPLAY_VIRTUAL_HIGHLIGHT,
      DEFAULT_CODE_DISPLAY_CONFIG.virtualHighlightEnabled
    ),
    workerEnabled: parseBooleanEnv(
      env.CCH_CODEDISPLAY_WORKER_ENABLE,
      DEFAULT_CODE_DISPLAY_CONFIG.workerEnabled
    ),
    perfDebugEnabled: parseBooleanEnv(
      env.CCH_CODEDISPLAY_PERF_DEBUG,
      DEFAULT_CODE_DISPLAY_CONFIG.perfDebugEnabled
    ),
    highlightMaxChars: parseIntEnv(
      env.CCH_CODEDISPLAY_HIGHLIGHT_MAX_CHARS,
      DEFAULT_CODE_DISPLAY_CONFIG.highlightMaxChars,
      { min: 1000, max: 5_000_000 }
    ),
    virtualOverscanLines: parseIntEnv(
      env.CCH_CODEDISPLAY_VIRTUAL_OVERSCAN_LINES,
      DEFAULT_CODE_DISPLAY_CONFIG.virtualOverscanLines,
      { min: 0, max: 5000 }
    ),
    virtualLineHeightPx: parseIntEnv(
      env.CCH_CODEDISPLAY_VIRTUAL_LINE_HEIGHT_PX,
      DEFAULT_CODE_DISPLAY_CONFIG.virtualLineHeightPx,
      { min: 10, max: 64 }
    ),
    virtualContextLines: parseIntEnv(
      env.CCH_CODEDISPLAY_VIRTUAL_CONTEXT_LINES,
      DEFAULT_CODE_DISPLAY_CONFIG.virtualContextLines,
      { min: 0, max: 5000 }
    ),
    maxPrettyOutputBytes: parseIntEnv(
      env.CCH_CODEDISPLAY_MAX_PRETTY_OUTPUT_BYTES,
      DEFAULT_CODE_DISPLAY_CONFIG.maxPrettyOutputBytes,
      { min: 1_000_000, max: 200_000_000 }
    ),
    maxLineIndexLines: parseIntEnv(
      env.CCH_CODEDISPLAY_MAX_LINE_INDEX_LINES,
      DEFAULT_CODE_DISPLAY_CONFIG.maxLineIndexLines,
      { min: 10_000, max: 2_000_000 }
    ),
  };
}
