import { getEnvConfig } from "@/lib/config/env.schema";
import {
  getProxyRuntimeSettings,
  type ProxyRuntimeSettings,
} from "@/lib/system-settings/proxy-runtime";

/**
 * F3a 亲和路由总开关：env 强制开启，或系统设置「忽略客户端 Session ID」开启（产品默认开）。
 * 日常开关由系统设置驱动，ENABLE_PREFIX_AFFINITY 仅作显式强制/兜底。
 */
export function isAffinityRoutingEnabledWith(settings: ProxyRuntimeSettings): boolean {
  return getEnvConfig().ENABLE_PREFIX_AFFINITY || settings.affinityIgnoreClientSessionId;
}

export async function isAffinityRoutingEnabled(): Promise<boolean> {
  return isAffinityRoutingEnabledWith(await getProxyRuntimeSettings());
}
