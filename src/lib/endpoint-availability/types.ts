import type { AvailabilityStatus } from "@/lib/availability";
import type { ProviderType } from "@/types/provider";

export interface EndpointAvailabilityQueryOptions {
  startTime?: Date | string;
  endTime?: Date | string;
  endpointIds?: number[];
  vendorIds?: number[];
  providerTypes?: ProviderType[];
  bucketSizeMinutes?: number;
  includeDisabled?: boolean;
  maxBuckets?: number;
}

export interface EndpointTimeBucketMetrics {
  bucketStart: string;
  bucketEnd: string;
  totalProbes: number;
  greenCount: number;
  redCount: number;
  availabilityScore: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface EndpointAvailabilitySummary {
  endpointId: number;
  vendorId: number;
  vendorName: string;
  providerType: ProviderType;
  baseUrl: string;
  isEnabled: boolean;
  currentStatus: AvailabilityStatus;
  currentAvailability: number;
  totalProbes: number;
  successRate: number;
  avgLatencyMs: number;
  lastProbeAt: string | null;
  timeBuckets: EndpointTimeBucketMetrics[];
}

export interface EndpointAvailabilityQueryResult {
  queriedAt: string;
  startTime: string;
  endTime: string;
  bucketSizeMinutes: number;
  endpoints: EndpointAvailabilitySummary[];
  systemAvailability: number;
}
