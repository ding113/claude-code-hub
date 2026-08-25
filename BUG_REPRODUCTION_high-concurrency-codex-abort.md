# Bug Reproduction: High-Concurrency Mode + Codex Client Abort → 499 + Session Binding Loss

## Summary

High-concurrency mode incorrectly reclassifies completed streaming responses as 499 errors when the client disconnects after reading the final `response.completed` frame. This triggers session binding clearance, causing subsequent requests to lose affinity routing and suffer ~40% prompt cache miss rate.

## Production Evidence (2025-04-17)

**Request 195393** (the smoking gun):
```
Provider Chain:
  affinity_hit (Provider A)    → 10:52:44
  request_success (200)         → 11:01:44  (first-byte commit)
  system_error (499)            → 11:01:49  (5s later, after client abort)
```

**Cascade impact** (18 subsequent requests):
- All started with `initial_selection` instead of `affinity_hit`/`session_reuse`
- Cycled through different providers without session stickiness
- Prompt cache hit rate dropped ~40% (measured by token usage deltas)

## Root Cause

Two independent layers combine to produce the bug:

### Layer 1: Predicate Short-Circuit
```typescript
// src/app/v1/_lib/proxy/session.ts:594
shouldRetainClientAbortBilling(): boolean {
  return !this.highConcurrencyModeEnabled;
}
```

When high-concurrency mode is enabled, this method returns `false`, which short-circuits the `clientAbortCompleteSuccess` IIFE at response-handler.ts:1962:

```typescript
const clientAbortCompleteSuccess = (() => {
  if (
    typeof session.shouldRetainClientAbortBilling === "function" &&
    !session.shouldRetainClientAbortBilling()  // ← L1: false in high-concurrency mode
  )
    return false;  // ← Exits early, never checks completion marker
  // ... rest of the logic that validates stream completion
})();
```

### Layer 2: Evidence Discard
```typescript
// src/app/v1/_lib/proxy/response-handler.ts:3602
const clientAbortMeter: ClientAbortMeteringObserver =
  typeof session.shouldRetainClientAbortBilling !== "function" ||
  session.shouldRetainClientAbortBilling()
    ? createClientAbortMeteringObserver(session.originalFormat)
    : {
        observe: () => ({ billingComplete: false }),
        finish: () => ({
          text: "",  // ← L2: all evidence discarded
          billingComplete: false,
          retainedBytes: 0,
          skippedOversizedFrames: 0,
          protocolFailure: null,
        }),
      };
```

When high-concurrency mode is enabled, the real metering observer is replaced with a stub that returns empty text. Even if L1 were fixed, `hasStreamCompletionMarker(allContent, format)` would return `false` because `allContent === ""`.

### Consequence Chain

1. `clientAbortCompleteSuccess = false` (due to L1 or L2)
2. `effectiveStatusCode = 499` (response-handler.ts:2024)
3. `shouldClearSessionBindingOnFailure = true` (response-handler.ts:2051)
4. `clearSessionBinding()` is called (response-handler.ts:2119-2131)
5. Redis session:provider binding deleted
6. Affinity state may be tombstoned (affinity-recorder.ts:58)
7. Next request loses routing affinity → weighted random provider selection
8. Provider mismatch → prompt cache miss → higher token costs

## Why This Matters

**Cost impact per affected request**:
- Primary: Lost prompt cache benefit (40% more input tokens billed)
- Secondary: Unnecessary provider switching increases variance
- Tertiary: Session context fragmentation across providers

**Blast radius**:
- Affects all Codex CLI users (codex_cli_rs reads exactly to `response.completed` then disconnects)
- Affects any client that terminates the connection immediately after reading the final frame
- Only occurs when `enable_high_concurrency_mode = true`

## Local Reproduction

```bash
cd /home/ding/.paseo/worktrees/3fbx83uv/tame-crab
bun run test tests/unit/proxy/high-concurrency-codex-abort-499.test.ts
```

**Test file**: `tests/unit/proxy/high-concurrency-codex-abort-499.test.ts`

The test suite validates:
1. L2: High-concurrency mode discards completion evidence entirely
2. L2 baseline: Normal mode retains `response.completed` + usage evidence
3. Bug reproduction: Same finished stream → 499 (high-concurrency) vs 200 (normal)
4. L1 alone: Even with full evidence, the predicate rejects it
5. Session binding cascade: 499 sets `shouldClearSessionBindingOnFailure = true`
6. Normal mode baseline: Completed streams don't clear session binding

## Why the "5 Second Delay" Between 200 and 499

The provider chain shows:
```
request_success (200)  → 11:01:44
system_error (499)     → 11:01:49  (5s later)
```

This is **not** a delayed failure detection. It's the natural timeline of deferred streaming finalization:

1. **11:01:44**: First byte arrives from upstream
   - Hedge winner / single-path success commits `request_success` with status 200
   - `setDeferredStreamingFinalization()` stores metadata for later
   - Response headers are sent to client immediately

2. **11:01:44 - 11:01:49**: Stream body flows
   - Client reads chunks
   - Client sees `response.completed` event
   - Client closes connection (Codex CLI behavior: read exactly to completion, then disconnect)

3. **11:01:49**: Finalization runs
   - `finalizeDeferredStreamingFinalizationIfNeeded()` is called
   - `clientAborted = true`, `streamEndedNormally = true`, `upstreamStatusCode = 200`
   - High-concurrency mode: `clientAbortCompleteSuccess = false` (L1 + L2)
   - `effectiveStatusCode = 499`, appends `system_error` to provider chain
   - `clearSessionBinding()` nukes Redis session:provider binding

The 200 and 499 are **both correct from their respective vantage points**:
- 200: What the client actually received (successful HTTP response)
- 499: Internal accounting status code for billing/routing (treated as failure due to the bug)

## Related Code Paths

### Where the 200 Comes From

**Hedge winner path** (forwarder.ts:5185):
```typescript
session.addProviderToChain(attempt.provider, {
  ...attempt.endpointAudit,
  reason: isActualHedgeWin ? "hedge_winner" : "request_success",
  attemptNumber: attempt.sequence,
  statusCode: attempt.response.status,  // ← 200 from upstream
  // ...
});
```

**Single-path non-streaming success** (forwarder.ts:2120):
```typescript
session.addProviderToChain(currentProvider, {
  ...endpointAudit,
  reason:
    totalProvidersAttempted === 1 && attemptCount === 1
      ? "request_success"
      : "retry_success",
  attemptNumber: attemptCount,
  statusCode: response.status,  // ← 200 from upstream
  // ...
});
```

### Where the 499 Comes From

**Deferred streaming finalization** (response-handler.ts:2024, 2120):
```typescript
} else if (clientAborted) {
  effectiveStatusCode = 499;
  errorMessage = "CLIENT_ABORTED";
}

// ...

session.addProviderToChain(providerForChain, {
  endpointId: meta.endpointId,
  endpointUrl: meta.endpointUrl,
  reason: "system_error",
  attemptNumber: meta.attemptNumber,
  statusCode: effectiveStatusCode,  // ← 499 due to clientAborted=true
  errorMessage: errorMessage ?? undefined,
});
```

## Why Circuit Breaker Wasn't Triggered

The circuit breaker logic has an explicit exemption for client aborts (response-handler.ts:2135):

```typescript
if (!clientAborted && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
  try {
    const { recordFailure } = await import("@/lib/circuit-breaker");
    await recordFailure(meta.providerId, new Error(errorMessage ?? "STREAM_ABORTED"));
  } catch (cbError) {
    // ...
  }
}
```

The `!clientAborted` guard correctly prevents the 499 from poisoning the circuit breaker. However, session binding clearance happens unconditionally:

```typescript
if ((clientAborted || !streamEndedNormally) && !clientAbortCompleteSuccess) {
  session.addProviderToChain(/* ... */);

  const commitSideEffects = async () => {
    try {
      await clearSessionBinding();  // ← No guard here
      // ...
    }
  };
}
```

## Mitigation Options

### Option 1: Disable High-Concurrency Mode (Immediate, Reversible)
```sql
UPDATE system_settings SET enable_high_concurrency_mode = false;
```

**Pros**:
- Takes effect within 60s (settings cache TTL)
- No code deployment required
- Fully reversible

**Cons**:
- Re-enables the "client_abort_drain_timeout" path that caused 5 OOM events in v0.9.3
- However, v0.9.4 added safeguards (#1439 + #1440):
  - Explicit `destroy()` on error streams
  - Process-wide drain budget (64 concurrent / 64 MiB)

**Safety**: The OOM safeguards are independent AND gates. Disabling high-concurrency mode does NOT re-enable:
- Stream content gate (`stream_gate_mode = off`)
- Hedge loser billing (`bill_hedge_losers = false`)
- Request replay (`ENABLE_REQUEST_REPLAY = false`)

### Option 2: Add Fine-Grained Override (Code Change)
```typescript
// session.ts:594
shouldRetainClientAbortBilling(): boolean {
  // New flag: RETAIN_CLIENT_ABORT_BILLING_IN_HIGH_CONCURRENCY (default false for compat)
  if (this.highConcurrencyModeEnabled) {
    return getEnvConfig().RETAIN_CLIENT_ABORT_BILLING_IN_HIGH_CONCURRENCY ?? false;
  }
  return true;
}
```

**Pros**:
- Surgical fix, doesn't affect other high-concurrency behavior
- Preserves the cancelSource("client_detached_high_concurrency") fast path
- Can be enabled via env var without DB migration

**Cons**:
- Requires code deployment
- Needs coordination with drain budget tuning

### Option 3: Fix L1 + L2 Properly (Code Change)
Remove the L1 short-circuit and always use the real metering observer:

```typescript
// response-handler.ts:1962
const clientAbortCompleteSuccess = (() => {
  // Remove this block:
  // if (
  //   typeof session.shouldRetainClientAbortBilling === "function" &&
  //   !session.shouldRetainClientAbortBilling()
  // )
  //   return false;

  if (!clientAborted || upstreamStatusCode < 200 || upstreamStatusCode >= 300) {
    return false;
  }
  // ... rest of the logic
})();

// response-handler.ts:3602
const clientAbortMeter: ClientAbortMeteringObserver =
  createClientAbortMeteringObserver(session.originalFormat);  // Always use real observer
```

**Pros**:
- Proper fix for the root cause
- High-concurrency mode retains fast abort path (cancelSource) while still getting correct billing

**Cons**:
- Requires careful testing to ensure drain budget is sufficient
- May need to increase `CLIENT_ABORT_DRAIN_RESERVATION_BYTES` or process-wide limits

## Recommendation

**Short-term** (production hotfix):
- Disable high-concurrency mode via DB flag
- Monitor for OOM (shouldn't happen due to v0.9.4 safeguards, but watch closely)

**Medium-term** (next release):
- Implement Option 3 (remove L1 + L2 guards)
- Increase drain budget conservatively if needed
- Add integration test with realistic Codex abort pattern

**Long-term** (architecture):
- Consider making the metering observer always active (even in high-concurrency mode)
- Separate "fast abort transport" from "billing evidence retention"
- Add observability: track how often `clientAbortCompleteSuccess` rescues a 499

## Test Coverage

The reproduction test validates both layers independently and together:

1. **L2 evidence discard**: High-concurrency mode returns empty text from meter
2. **L2 baseline**: Normal mode retains `response.completed` + usage
3. **Bug reproduction**: Same stream → 499 (high-concurrency) vs 200 (normal)
4. **L1 predicate**: Even with full evidence, high-concurrency mode rejects it
5. **Session binding cascade**: 499 sets `shouldClearSessionBindingOnFailure = true`
6. **Normal baseline**: Completed streams don't clear session binding

All tests pass, confirming the bug mechanism is correctly understood.

## References

- Production logs: Request 195393 + subsequent 18 requests (2025-04-17 10:52-11:05)
- Code locations:
  - L1: `src/app/v1/_lib/proxy/session.ts:594`
  - L2: `src/app/v1/_lib/proxy/response-handler.ts:3602`
  - Finalization: `src/app/v1/_lib/proxy/response-handler.ts:1962-2131`
  - Session binding clear: `src/app/v1/_lib/proxy/response-handler.ts:2119-2131`
  - Affinity tombstone: `src/app/v1/_lib/proxy/affinity/affinity-recorder.ts:58`
- Related issues:
  - #1439: Explicit destroy() on error streams (v0.9.4)
  - #1440: Process-wide drain budget (v0.9.4)
- Test file: `tests/unit/proxy/high-concurrency-codex-abort-499.test.ts`
