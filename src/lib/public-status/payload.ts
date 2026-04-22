import type { PublicStatusServeState } from "./redis-contract";

export type PublicStatusTimelineState = "operational" | "degraded" | "failed" | "no_data";

export interface PublicStatusTimelineBucket {
  bucketStart: string;
  bucketEnd: string;
  state: PublicStatusTimelineState;
  availabilityPct: number | null;
  ttfbMs: number | null;
  tps: number | null;
  sampleCount: number;
}

export interface PublicStatusModelSnapshot {
  publicModelKey: string;
  label: string;
  vendorIconKey: string;
  requestTypeBadge: string;
  latestState: PublicStatusTimelineState;
  availabilityPct: number | null;
  latestTtfbMs: number | null;
  latestTps: number | null;
  timeline: PublicStatusTimelineBucket[];
}

export interface PublicStatusGroupSnapshot {
  publicGroupSlug: string;
  displayName: string;
  explanatoryCopy: string | null;
  models: PublicStatusModelSnapshot[];
}

export interface PublicStatusPayload {
  rebuildState: PublicStatusServeState;
  sourceGeneration: string;
  generatedAt: string | null;
  freshUntil: string | null;
  groups: PublicStatusGroupSnapshot[];
}
