# Task Plan: First-byte timeout hedge (no cancel primary)

## Goal
On streaming first-byte timeout: keep current request alive, launch second-best health-qualified alternate; respond with fastest first-byte. No alternate → no hedge. Commit prior health-test work first as rollback point.

## Phases
- [x] Phase 1: commit current health-test / group / budget work
- [ ] Phase 2: enable streaming hedge when firstByteTimeout > 0
- [ ] Phase 3: alternate = health-aware second best; skip if none
- [ ] Phase 4: ensure timeout does not abort primary; deploy + smoke

## Constraints
- Do not cancel primary on first-byte timeout
- No alternate candidate → do not race
- Prefer existing sendStreamingWithHedge path over rewrite
