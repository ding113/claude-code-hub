import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";

/**
 * 代理热路径消费的系统设置快照。
 *
 * - streamGateMode：F1 流式内容门控模式（系统设置优先，env 兜底；产品默认 enforce）
 * - affinityIgnoreClientSessionId：F3a「忽略客户端 Session ID」开关（默认开）——
 *   可指纹化的请求强制使用最长前缀亲和做供应商粘性，跳过 session-ID 绑定读取；
 *   不可指纹化的请求仍走既有 session 复用。
 * - replayEnabled：F2 Replay 有效开关（系统设置覆写优先，null 时跟随 env）
 * - cacheEffectivenessEnabled：F3b 缓存模拟有效开关（同上）
 *
 * 读取约定：热路径用 getCachedProxyRuntimeSettings()（同步、最近快照），
 * 异步场景用 getProxyRuntimeSettings()（带 TTL 缓存）。
 */
export interface ProxyRuntimeSettings {
  streamGateMode: "off" | "shadow" | "enforce";
  affinityIgnoreClientSessionId: boolean;
  replayEnabled: boolean;
  cacheEffectivenessEnabled: boolean;
}

// 最近一次成功读取的快照；同步热路径消费，异步读取与开机预热负责保鲜。
let lastKnown: ProxyRuntimeSettings | null = null;

function envReplayDefault(): boolean {
  try {
    return getEnvConfig().ENABLE_REQUEST_REPLAY;
  } catch {
    return false;
  }
}

function envCacheEffectivenessDefault(): boolean {
  try {
    return getEnvConfig().ENABLE_CACHE_EFFECTIVENESS;
  } catch {
    return true;
  }
}

function envFallback(): ProxyRuntimeSettings {
  try {
    const env = getEnvConfig();
    return {
      streamGateMode: env.STREAM_GATE_MODE,
      affinityIgnoreClientSessionId: true,
      replayEnabled: env.ENABLE_REQUEST_REPLAY,
      cacheEffectivenessEnabled: env.ENABLE_CACHE_EFFECTIVENESS,
    };
  } catch {
    return {
      streamGateMode: "off",
      affinityIgnoreClientSessionId: true,
      replayEnabled: false,
      cacheEffectivenessEnabled: true,
    };
  }
}

export async function getProxyRuntimeSettings(): Promise<ProxyRuntimeSettings> {
  try {
    const settings = await getCachedSystemSettings();
    lastKnown = {
      streamGateMode: settings.streamGateMode,
      affinityIgnoreClientSessionId: settings.affinityIgnoreClientSessionId,
      replayEnabled: settings.replayEnabled ?? envReplayDefault(),
      cacheEffectivenessEnabled:
        settings.cacheEffectivenessEnabled ?? envCacheEffectivenessDefault(),
    };
    return lastKnown;
  } catch {
    // getCachedSystemSettings 自身已 fail-safe；此处兜底其意外异常
    return lastKnown ?? envFallback();
  }
}

/**
 * 同步返回最近快照；尚无快照时返回 null，调用方自行 env 兜底。
 */
export function getCachedProxyRuntimeSettings(): ProxyRuntimeSettings | null {
  return lastKnown;
}

/** F3b 有效开关（同步）：系统设置覆写优先，无快照时跟随 env。 */
export function isCacheEffectivenessEnabled(): boolean {
  return lastKnown?.cacheEffectivenessEnabled ?? envCacheEffectivenessDefault();
}
