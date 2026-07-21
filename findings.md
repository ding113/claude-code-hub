# Findings: SLO-gated scheduled health rebalance

## User rules (final)
- Isolate by provider type: claude / codex / openai-compatible
- Need **two** SLO-qualified (80% online, avg first-byte ≤10s): primary + backup
- Sort: priority ASC (lower better), then avgFirstByte ASC, then id
- Keep top 2 scheduled ON; auto-disable everyone else in pool
- If <2 qualified → re-enable auto-disabled → all-open exploration
- Manual off and budget suspend must not be force re-enabled by rebalance

## Implementation
- Column `health_test_slo_auto_disabled` marks rebalance-owned offs
- Pure logic in `slo-rebalance.ts` + apply in repository + call each scheduler cycle
