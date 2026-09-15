/** Keep the precommit lease alive on wall time, including local admission pauses. */
export function startDiscoveryLeaseHeartbeat(options: {
  ttlMs: number;
  renew: () => Promise<boolean>;
  onLost: () => void;
}): () => void {
  let stopped = false;
  let renewing = false;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let renewalTimer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    stopped = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    if (renewalTimer) clearInterval(renewalTimer);
    expiryTimer = null;
    renewalTimer = null;
  };
  const lost = () => {
    if (stopped) return;
    stop();
    options.onLost();
  };
  const armExpiry = (delayMs: number) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(lost, Math.max(0, delayMs));
    expiryTimer.unref?.();
  };
  armExpiry(options.ttlMs);
  renewalTimer = setInterval(
    () => {
      if (stopped || renewing) return;
      renewing = true;
      const startedAt = Date.now();
      void options.renew().then(
        (owned) => {
          renewing = false;
          if (stopped) return;
          if (!owned) {
            lost();
            return;
          }
          // Count from dispatch, not receipt: a delayed Redis result must not
          // overstate how long the server-side lease remains valid.
          armExpiry(options.ttlMs - (Date.now() - startedAt));
        },
        () => {
          renewing = false;
          lost();
        }
      );
    },
    Math.max(250, Math.floor(options.ttlMs / 3))
  );
  renewalTimer.unref?.();
  return stop;
}
