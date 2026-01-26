import type { Key } from "@/types/key";
import type { ProviderDisplay } from "@/types/provider";

/**
 * Filter values for usage logs
 */
export interface UsageLogFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  sessionId?: string;
  /** Start timestamp (ms, local timezone 00:00:00) */
  startTime?: number;
  /** End timestamp (ms, local timezone next day 00:00:00, for < comparison) */
  endTime?: number;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  minRetryCount?: number;
}

/**
 * Props passed to filter section components
 */
export interface FilterSectionProps {
  isAdmin: boolean;
  filters: UsageLogFilters;
  onFiltersChange: (filters: UsageLogFilters) => void;
}

/**
 * Props for identity filters (user + key)
 */
export interface IdentityFiltersProps extends FilterSectionProps {
  initialKeys: Key[];
  isKeysLoading?: boolean;
}

/**
 * Props for request filters (provider + model + endpoint + session)
 */
export interface RequestFiltersProps extends FilterSectionProps {
  providers: ProviderDisplay[];
  isProvidersLoading?: boolean;
}

/**
 * Display names resolver
 */
export interface FilterDisplayNames {
  getUserName: (id: number) => string | undefined;
  getKeyName: (id: number) => string | undefined;
  getProviderName: (id: number) => string | undefined;
}
