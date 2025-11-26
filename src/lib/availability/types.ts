/**
 * Provider Availability Service Types
 * Based on relay-pulse aggregation patterns
 */

/**
 * Status values for availability calculation
 * - GREEN (1.0): HTTP 2xx/3xx (all successful requests)
 * - RED (0.0): HTTP 4xx/5xx or error
 * - UNKNOWN (-1): No data available (must be displayed honestly as "no data")
 */
export type AvailabilityStatus = "green" | "red" | "unknown";

/**
 * Numeric weights for availability calculation
 */
export const AVAILABILITY_WEIGHTS: Record<AvailabilityStatus, number> = {
  green: 1.0,
  red: 0.0,
  unknown: -1, // Special value for "no data" - must be honest!
};

/**
 * Default thresholds
 */
export const AVAILABILITY_DEFAULTS = {
  /** Minimum sample size for reliable metrics */
  MIN_SAMPLE_SIZE: 5,
  /** Time bucket granularities in minutes */
  TIME_BUCKETS: {
    MINUTE_1: 1,
    MINUTE_5: 5,
    MINUTE_15: 15,
    HOUR_1: 60,
    DAY_1: 1440,
  },
} as const;

/**
 * Request status classification result
 */
export interface RequestStatusClassification {
  status: AvailabilityStatus;
  isSuccess: boolean;
  isError: boolean;
}

/**
 * Single time bucket aggregation
 */
export interface TimeBucketMetrics {
  /** Bucket start time (ISO string) */
  bucketStart: string;
  /** Bucket end time (ISO string) */
  bucketEnd: string;
  /** Total request count */
  totalRequests: number;
  /** Successful requests (2xx/3xx) */
  greenCount: number;
  /** Failed requests (4xx/5xx or error) */
  redCount: number;
  /** Weighted availability score (0.0-1.0) */
  availabilityScore: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** P50 latency in ms */
  p50LatencyMs: number;
  /** P95 latency in ms */
  p95LatencyMs: number;
  /** P99 latency in ms */
  p99LatencyMs: number;
}

/**
 * Provider availability summary
 */
export interface ProviderAvailabilitySummary {
  /** Provider ID */
  providerId: number;
  /** Provider name */
  providerName: string;
  /** Provider type */
  providerType: string;
  /** Whether provider is enabled */
  isEnabled: boolean;
  /** Current status based on recent requests */
  currentStatus: AvailabilityStatus;
  /** Current weighted availability (0.0-1.0) */
  currentAvailability: number;
  /** Total request count in period */
  totalRequests: number;
  /** Success rate (green requests / total) */
  successRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Last request timestamp */
  lastRequestAt: string | null;
  /** Time bucket metrics */
  timeBuckets: TimeBucketMetrics[];
}

/**
 * Availability query options
 */
export interface AvailabilityQueryOptions {
  /** Start time for query (ISO string or Date) */
  startTime?: string | Date;
  /** End time for query (ISO string or Date) */
  endTime?: string | Date;
  /** Provider IDs to filter (empty = all providers) */
  providerIds?: number[];
  /** Time bucket size in minutes */
  bucketSizeMinutes?: number;
  /** Whether to include disabled providers */
  includeDisabled?: boolean;
  /** Maximum number of time buckets to return */
  maxBuckets?: number;
}

/**
 * Availability query result
 */
export interface AvailabilityQueryResult {
  /** Query timestamp */
  queriedAt: string;
  /** Query time range start */
  startTime: string;
  /** Query time range end */
  endTime: string;
  /** Time bucket size used (in minutes) */
  bucketSizeMinutes: number;
  /** Provider summaries */
  providers: ProviderAvailabilitySummary[];
  /** Overall system availability (weighted average) */
  systemAvailability: number;
}

/**
 * Raw request data from database
 */
export interface RawRequestData {
  id: number;
  providerId: number;
  statusCode: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: Date | null;
}

/**
 * Aggregated bucket data from database
 */
export interface AggregatedBucketData {
  providerId: number;
  bucketStart: Date;
  totalRequests: number;
  greenCount: number;
  redCount: number;
  avgLatencyMs: number;
  latencies: number[];
}
