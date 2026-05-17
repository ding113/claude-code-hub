export interface SessionData {
  sessionId: string;
  keyFingerprint: string;
  credentialType: "session" | "admin-token" | "user-api-key";
  userId: number;
  userRole: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore {
  create(
    data: Omit<SessionData, "sessionId" | "createdAt" | "expiresAt">,
    ttlSeconds?: number
  ): Promise<SessionData>;
  read(sessionId: string): Promise<SessionData | null>;
  revoke(sessionId: string): Promise<boolean>;
  rotate(oldSessionId: string): Promise<SessionData | null>;
}

export const DEFAULT_AUTH_SESSION_TTL_SECONDS = 604_800;
/**
 * @deprecated 仅为兼容旧调用保留；新代码请使用 DEFAULT_AUTH_SESSION_TTL_SECONDS。
 */
export const DEFAULT_SESSION_TTL = DEFAULT_AUTH_SESSION_TTL_SECONDS;
