export interface LoginAbuseConfig {
  maxAttemptsPerIp: number;
  maxAttemptsPerKey: number;
  windowSeconds: number;
  lockoutSeconds: number;
}

export interface LoginAbuseDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

export const DEFAULT_LOGIN_ABUSE_CONFIG: LoginAbuseConfig = {
  maxAttemptsPerIp: 10,
  maxAttemptsPerKey: 10,
  windowSeconds: 300,
  lockoutSeconds: 900,
};

type AttemptRecord = {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
};

const MAX_TRACKED_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

export class LoginAbusePolicy {
  private attempts = new Map<string, AttemptRecord>();
  private config: LoginAbuseConfig;
  private lastSweepAt = 0;

  constructor(config?: Partial<LoginAbuseConfig>) {
    this.config = {
      ...DEFAULT_LOGIN_ABUSE_CONFIG,
      ...config,
    };
  }

  private sweepStaleEntries(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastSweepAt = now;

    for (const [key, record] of this.attempts) {
      if (record.lockedUntil != null) {
        if (record.lockedUntil <= now) {
          this.attempts.delete(key);
        }
      } else if (this.isWindowExpired(record, now)) {
        this.attempts.delete(key);
      }
    }

    if (this.attempts.size > MAX_TRACKED_ENTRIES) {
      const excess = this.attempts.size - MAX_TRACKED_ENTRIES;
      const iterator = this.attempts.keys();
      for (let i = 0; i < excess; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.attempts.delete(next.value);
      }
    }
  }

  check(ip: string, key?: string): LoginAbuseDecision {
    const now = Date.now();
    this.sweepStaleEntries(now);

    const ipDecision = this.checkScope({
      scopeKey: this.toIpScope(ip),
      threshold: this.config.maxAttemptsPerIp,
      reason: "ip_rate_limited",
      now,
    });

    if (!ipDecision.allowed || !key) {
      return ipDecision;
    }

    return this.checkScope({
      scopeKey: this.toKeyScope(key),
      threshold: this.config.maxAttemptsPerKey,
      reason: "key_rate_limited",
      now,
    });
  }

  recordFailure(ip: string, key?: string): void {
    const now = Date.now();

    this.recordFailureForScope({
      scopeKey: this.toIpScope(ip),
      threshold: this.config.maxAttemptsPerIp,
      now,
    });

    if (!key) {
      return;
    }

    this.recordFailureForScope({
      scopeKey: this.toKeyScope(key),
      threshold: this.config.maxAttemptsPerKey,
      now,
    });
  }

  recordSuccess(ip: string, key?: string): void {
    this.reset(ip, key);
  }

  reset(ip: string, key?: string): void {
    this.attempts.delete(this.toIpScope(ip));

    if (!key) {
      return;
    }

    this.attempts.delete(this.toKeyScope(key));
  }

  private checkScope(params: {
    scopeKey: string;
    threshold: number;
    reason: string;
    now: number;
  }): LoginAbuseDecision {
    const { scopeKey, threshold, reason, now } = params;
    const record = this.attempts.get(scopeKey);

    if (!record) {
      return { allowed: true };
    }

    if (record.lockedUntil != null) {
      if (record.lockedUntil > now) {
        return {
          allowed: false,
          retryAfterSeconds: this.calculateRetryAfterSeconds(record.lockedUntil, now),
          reason,
        };
      }

      this.attempts.delete(scopeKey);
      return { allowed: true };
    }

    if (this.isWindowExpired(record, now)) {
      this.attempts.delete(scopeKey);
      return { allowed: true };
    }

    if (record.count >= threshold) {
      const lockedUntil = now + this.config.lockoutSeconds * 1000;
      this.attempts.set(scopeKey, { ...record, lockedUntil });
      return {
        allowed: false,
        retryAfterSeconds: this.calculateRetryAfterSeconds(lockedUntil, now),
        reason,
      };
    }

    return { allowed: true };
  }

  private recordFailureForScope(params: {
    scopeKey: string;
    threshold: number;
    now: number;
  }): void {
    const { scopeKey, threshold, now } = params;
    const record = this.attempts.get(scopeKey);

    if (!record) {
      this.attempts.set(scopeKey, this.createFirstRecord(now, threshold));
      return;
    }

    if (record.lockedUntil != null) {
      if (record.lockedUntil > now) {
        return;
      }

      this.attempts.set(scopeKey, this.createFirstRecord(now, threshold));
      return;
    }

    if (this.isWindowExpired(record, now)) {
      this.attempts.set(scopeKey, this.createFirstRecord(now, threshold));
      return;
    }

    const nextCount = record.count + 1;
    const nextRecord: AttemptRecord = {
      count: nextCount,
      firstAttempt: record.firstAttempt,
    };

    if (nextCount >= threshold) {
      nextRecord.lockedUntil = now + this.config.lockoutSeconds * 1000;
    }

    this.attempts.set(scopeKey, nextRecord);
  }

  private isWindowExpired(record: AttemptRecord, now: number): boolean {
    return now - record.firstAttempt >= this.config.windowSeconds * 1000;
  }

  private calculateRetryAfterSeconds(lockedUntil: number, now: number): number {
    return Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  }

  private createFirstRecord(now: number, threshold: number): AttemptRecord {
    const firstRecord: AttemptRecord = {
      count: 1,
      firstAttempt: now,
    };

    if (threshold <= 1) {
      firstRecord.lockedUntil = now + this.config.lockoutSeconds * 1000;
    }

    return firstRecord;
  }

  private toIpScope(ip: string): string {
    return `ip:${ip}`;
  }

  private toKeyScope(key: string): string {
    return `key:${key}`;
  }
}
