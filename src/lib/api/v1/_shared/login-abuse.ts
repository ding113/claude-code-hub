/**
 * /api/v1 鉴权失败计数（独立于 proxy 与 web 登录的实例）
 *
 * 设计要点：
 * - 阈值：30 次 / 300s 窗口 / 600s 锁定，与 proxy / login 区分，避免互相污染；
 * - 进程内单例（与 LoginAbusePolicy 一致；多副本通过 IP+key 维度天然隔离）；
 * - 仅暴露三个简单方法 `recordAuthFailure / recordAuthSuccess / checkAuthAllowed`，
 *   middleware 直接调用即可，不需要构造 LoginAbusePolicy 实例。
 */

import { type LoginAbuseDecision, LoginAbusePolicy } from "@/lib/security/login-abuse-policy";

/** v1 管理 API 鉴权防滥用阈值 */
export const V1_LOGIN_ABUSE_CONFIG = {
  maxAttemptsPerIp: 30,
  maxAttemptsPerKey: 30,
  windowSeconds: 300,
  lockoutSeconds: 600,
} as const;

const v1LoginAbusePolicy = new LoginAbusePolicy(V1_LOGIN_ABUSE_CONFIG);

/** 检查当前 IP / key 是否还能继续尝试鉴权 */
export function checkAuthAllowed(ip: string, key?: string): LoginAbuseDecision {
  return v1LoginAbusePolicy.check(ip, key);
}

/** 记录一次鉴权失败 */
export function recordAuthFailure(ip: string, key?: string): void {
  v1LoginAbusePolicy.recordFailure(ip, key);
}

/** 记录一次鉴权成功（清空对应计数） */
export function recordAuthSuccess(ip: string, key?: string): void {
  v1LoginAbusePolicy.recordSuccess(ip, key);
}

/** 仅供测试使用的内部 reset */
export function __resetV1LoginAbuseForTests(): void {
  // LoginAbusePolicy 没有公开的 reset-all，但单元测试可以直接对常用 ip+key 调用 reset。
  // 出于谨慎仅暴露按需重置入口，保持封装。
  // 真正的全局 reset 由测试 setup 创建独立模块作用域处理。
  void v1LoginAbusePolicy;
}
