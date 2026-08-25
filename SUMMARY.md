# Bug Reproduction Summary

## What Was Found

Successfully reproduced and documented the production bug where high-concurrency mode incorrectly reclassifies completed streaming responses as 499 errors, causing session binding loss and ~40% prompt cache miss rate.

## Files Created

1. **Test Suite**: `tests/unit/proxy/high-concurrency-codex-abort-499.test.ts`
   - 6 tests, all passing
   - Validates both layers of the bug independently and together
   - Confirms session binding cascade behavior

2. **Documentation**: `BUG_REPRODUCTION_high-concurrency-codex-abort.md`
   - Complete root cause analysis
   - Production evidence walkthrough
   - Code path tracing
   - Mitigation options with pros/cons
   - Test coverage summary

## Root Cause (Two Independent Layers)

**Layer 1 (L1)**: Predicate short-circuit
```typescript
// src/app/v1/_lib/proxy/session.ts:594
shouldRetainClientAbortBilling(): boolean {
  return !this.highConcurrencyModeEnabled;  // Always false when enabled
}
```

**Layer 2 (L2)**: Evidence discard
```typescript
// src/app/v1/_lib/proxy/response-handler.ts:3602
const clientAbortMeter = session.shouldRetainClientAbortBilling()
  ? createClientAbortMeteringObserver(format)
  : { finish: () => ({ text: "" /* all evidence lost */ }) };
```

**Impact Chain**:
1. Codex CLI reads stream until `response.completed`, then disconnects
2. L1 + L2 → `clientAbortCompleteSuccess = false` (should be true)
3. `effectiveStatusCode = 499` (should be 200)
4. `clearSessionBinding()` is called (should be skipped)
5. Next request loses affinity → weighted random provider selection
6. Provider mismatch → prompt cache miss → 40% higher token costs

## Production Evidence

**Request 195393** (2025-04-17):
```
Provider Chain:
  affinity_hit → request_success (200) → system_error (499)
  10:52:44       11:01:44                11:01:49 (5s later)
```

**Cascade**: 18 subsequent requests cycled through providers without affinity, losing ~40% cache benefit.

## Why "request_success (200)" and "system_error (499)" Both Appear

This is NOT a double-write bug or race condition. It's **deferred streaming finalization**:

1. **First entry (200)**: Logged when response headers arrive (first byte)
   - Source: `forwarder.ts:5185` (hedge winner) or `forwarder.ts:2120` (single-path)
   - Timing: 11:01:44

2. **Second entry (499)**: Logged when stream finalization runs after client abort
   - Source: `response-handler.ts:2120` (finalizeDeferredStreaming)
   - Timing: 11:01:49 (5 seconds later, after stream body completed)

The 200 is what the client received. The 499 is the internal accounting status that triggers session binding clearance.

## Test Results

```bash
$ bun run test tests/unit/proxy/high-concurrency-codex-abort-499.test.ts
✓ L2: high-concurrency mode discards the completion evidence entirely
✓ L2 baseline: normal mode retains the response.completed + usage evidence
✓ reproduces the bug: same finished stream -> 499 on, 200 off
✓ L1 alone is enough: even with full evidence the predicate says no
✓ shouldClearSessionBindingOnFailure is true when clientAbortCompleteSuccess is false
✓ normal mode: shouldClearSessionBindingOnFailure is false for completed streams

Test Files  1 passed (1)
Tests  6 passed (6)
```

## Recommended Actions

### Immediate (Production)
```sql
-- Hotfix: disable high-concurrency mode
UPDATE system_settings SET enable_high_concurrency_mode = false;
```
Takes effect in 60s. Safe because v0.9.4 safeguards (#1439, #1440) prevent OOM from drain path.

### Next Release
Remove L1 + L2 guards so high-concurrency mode retains completion evidence:
- Remove predicate short-circuit at `response-handler.ts:1962`
- Always use real metering observer at `response-handler.ts:3602`
- Tune drain budget if needed

### Verification
Monitor these metrics after mitigation:
- Session affinity hit rate (should stabilize)
- Prompt cache effectiveness (should recover 40% loss)
- 499 classification rate (should drop for completed Codex streams)

## Why Circuit Breaker Wasn't Affected

The circuit breaker has an explicit `!clientAborted` guard (response-handler.ts:2135), so the 499 didn't poison provider health tracking. However, session binding clearance has no such guard, which is why the cascade occurred.

## Key Insight

Either layer alone is sufficient to trigger the bug:
- L1 alone: Predicate returns false even with full evidence
- L2 alone: Empty evidence causes completion marker check to fail
- L1 + L2 together: Guaranteed failure on every Codex abort

This explains why the bug is deterministic in high-concurrency mode.
