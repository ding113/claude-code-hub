/**
 * 简化的配置管理模块
 */

export { config } from "./config";
export { type EnvConfig, getEnvConfig, isDevelopment } from "./env.schema";
export {
  getCachedSystemSettings,
  invalidateSystemSettingsCache,
  isHttp2Enabled,
  isThinkingSignatureFixEnabled,
} from "./system-settings-cache";
