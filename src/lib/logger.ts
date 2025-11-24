import pino from "pino";
import { isDevelopment } from "./config/env.schema";

/**
 * 日志级别类型
 */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * 获取初始日志级别
 * - 优先使用环境变量 LOG_LEVEL
 * - 开发环境默认 debug
 * - 生产环境默认 info
 */
function getInitialLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

  if (envLevel && validLevels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }

  // 向后兼容：如果设置了 DEBUG_MODE，使用 debug 级别
  if (process.env.DEBUG_MODE === "true") {
    return "debug";
  }

  return isDevelopment() ? "debug" : "info";
}

/**
 * 创建 Pino 日志实例
 * pino-pretty 在 Next.js 15 + Turbopack 下有兼容性问题，暂时禁用
 * 在 Turbopack 环境下使用默认格式化器（不启用 pino-pretty)
 */
const enablePrettyTransport = isDevelopment() && !process.env.TURBOPACK;

const pinoInstance = pino({
  level: getInitialLogLevel(),
  transport: enablePrettyTransport
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  // 生产环境格式化时间戳为 ISO 8601 格式
  // timestamp 是顶级配置项，返回格式化的时间字符串
  timestamp: enablePrettyTransport
    ? undefined // pino-pretty 会处理时间格式
    : pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

/**
 * 日志包装器 - 支持灵活的参数顺序
 *
 * 支持两种调用方式：
 * 1. logger.info(obj, msg) - pino 原生方式
 * 2. logger.info(msg, obj) - 便捷方式
 */
function createLoggerWrapper(pinoLogger: pino.Logger) {
  const wrap = (level: pino.Level) => {
    return (arg1: unknown, arg2?: unknown, ...args: unknown[]) => {
      // 如果第一个参数是字符串,第二个参数是对象,自动交换
      if (typeof arg1 === "string" && arg2 && typeof arg2 === "object" && !Array.isArray(arg2)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pinoLogger[level](arg2 as any, arg1 as any, ...args);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pinoLogger[level](arg1 as any, arg2 as any, ...args);
      }
    };
  };

  return {
    fatal: wrap("fatal"),
    error: wrap("error"),
    warn: wrap("warn"),
    info: wrap("info"),
    debug: wrap("debug"),
    trace: wrap("trace"),
    get level() {
      return pinoLogger.level;
    },
    set level(newLevel: string) {
      pinoLogger.level = newLevel;
    },
  };
}

export const logger = createLoggerWrapper(pinoInstance);

/**
 * 运行时动态调整日志级别
 * @param newLevel 新的日志级别
 */
export function setLogLevel(newLevel: LogLevel): void {
  pinoInstance.level = newLevel;
  logger.info(`日志级别已调整为: ${newLevel}`);
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): string {
  return pinoInstance.level;
}
