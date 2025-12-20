import { isDevelopment } from "./config/env.schema";

/**
 * 日志级别类型
 */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

type LoggerWrapper = {
  fatal: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  error: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  warn: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  info: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  debug: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  trace: (arg1: unknown, arg2?: unknown, ...args: unknown[]) => void;
  level: string;
};

const levelPriority: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

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

function isValidLevel(level: string): level is LogLevel {
  return level in levelPriority;
}

function createConsoleLogger(initialLevel: LogLevel): LoggerWrapper {
  let currentLevel: LogLevel = initialLevel;

  const shouldLog = (level: LogLevel) => levelPriority[level] >= levelPriority[currentLevel];
  const wrap = (method: (...args: unknown[]) => void, level: LogLevel) => {
    return (arg1: unknown, arg2?: unknown, ...args: unknown[]) => {
      if (!shouldLog(level)) return;
      method(arg1, arg2, ...args);
    };
  };

  return {
    fatal: wrap(console.error, "fatal"),
    error: wrap(console.error, "error"),
    warn: wrap(console.warn, "warn"),
    info: wrap(console.info, "info"),
    debug: wrap(console.debug, "debug"),
    trace: wrap(console.trace, "trace"),
    get level() {
      return currentLevel;
    },
    set level(newLevel: string) {
      if (isValidLevel(newLevel)) {
        currentLevel = newLevel;
      }
    },
  };
}

type PinoLogger = import("pino").Logger;

/**
 * 日志包装器 - 支持灵活的参数顺序
 *
 * 支持两种调用方式：
 * 1. logger.info(obj, msg) - pino 原生方式
 * 2. logger.info(msg, obj) - 便捷方式
 */
function createLoggerWrapper(pinoLogger: PinoLogger): LoggerWrapper {
  const wrap = (level: LogLevel) => {
    return (arg1: unknown, arg2?: unknown, ...args: unknown[]) => {
      // 如果第一个参数是字符串,第二个参数是对象,自动交换
      if (typeof arg1 === "string" && arg2 && typeof arg2 === "object" && !Array.isArray(arg2)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pinoLogger[level] as any)(arg2 as any, arg1 as any, ...args);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pinoLogger[level] as any)(arg1 as any, arg2 as any, ...args);
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

const initialLevel = getInitialLogLevel();
let activeLogger: LoggerWrapper = createConsoleLogger(initialLevel);

async function initializePinoLogger(): Promise<void> {
  if (typeof window !== "undefined") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const pinoModule = await import("pino");
    const pino = pinoModule.default;
    const stdTimeFunctions = pinoModule.stdTimeFunctions ?? pino.stdTimeFunctions;
    const enablePrettyTransport = isDevelopment() && !process.env.TURBOPACK;

    const pinoInstance = pino({
      level: activeLogger.level,
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
        : stdTimeFunctions?.isoTime,
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    });

    activeLogger = createLoggerWrapper(pinoInstance);
  } catch (error) {
    activeLogger.warn("[Logger] Failed to initialize pino, falling back to console logging", {
      error,
    });
  }
}

void initializePinoLogger();

export const logger: LoggerWrapper = {
  fatal: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.fatal(arg1, arg2, ...args),
  error: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.error(arg1, arg2, ...args),
  warn: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.warn(arg1, arg2, ...args),
  info: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.info(arg1, arg2, ...args),
  debug: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.debug(arg1, arg2, ...args),
  trace: (arg1: unknown, arg2?: unknown, ...args: unknown[]) =>
    activeLogger.trace(arg1, arg2, ...args),
  get level() {
    return activeLogger.level;
  },
  set level(newLevel: string) {
    activeLogger.level = newLevel;
  },
};

/**
 * 运行时动态调整日志级别
 * @param newLevel 新的日志级别
 */
export function setLogLevel(newLevel: LogLevel): void {
  logger.level = newLevel;
  logger.info(`日志级别已调整为: ${newLevel}`);
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): string {
  return logger.level;
}
