export interface SessionData {
  sessionId: string;
  keyFingerprint: string;
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

export const DEFAULT_SESSION_TTL = 604800;
