import type { SessionDetailViewMode } from "@/types/session";

export type SessionSnapshotKind = "request" | "response";

export interface SessionSnapshotKey {
  sessionId: string;
  sequence: number;
  kind: SessionSnapshotKind;
  phase: SessionDetailViewMode;
}

export type SessionSnapshotData = Record<string, unknown>;

export interface SessionSnapshotStore {
  enqueuePatch(key: SessionSnapshotKey, patch: SessionSnapshotData, ttlSeconds: number): boolean;
  get(key: SessionSnapshotKey): Promise<SessionSnapshotData | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface StoredSessionSnapshotEnvelope {
  version: 1;
  expiresAt: number;
  updatedAt: number;
  data: SessionSnapshotData;
}
