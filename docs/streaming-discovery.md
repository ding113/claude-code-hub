# Bounded Streaming Discovery

Bounded Discovery is an optional cold-start routing mode for streaming
requests. It exists to reduce duplicate upstream spend while preserving a
working request when the first provider is slow.

## Defaults

| Setting | Default | Meaning |
| --- | ---: | --- |
| `discoveryEnabled` | `false` | Keep the existing Hedge path until explicitly enabled. |
| `discoveryConcurrency` | `2` | Number of normal providers in the first batch. |
| `maxDiscoveryRounds` | `2` | Maximum Discovery rounds. |
| `discoverySlaMs` | `10000` | First-byte budget for a Discovery round. |
| `stickySlaMs` | `20000` | First-byte budget for an existing Sticky provider. |
| `racingTotalTimeoutMs` | `60000` | Total pre-winner deadline; it is cleared after a winner is committed. |
| `stickyTimeoutCooldownMs` | `300000` | Session/provider cooldown after a Sticky timeout. |

The total deadline must be at least `stickySlaMs + maxDiscoveryRounds *
discoverySlaMs`. The UI and API reject configurations that do not satisfy
this relationship.

## Request lifecycle

- A healthy Sticky provider is probed alone. If it times out, it becomes the
  single fallback for this request and receives a cooldown; a later request
  may select it again after the cooldown.
- A cold start launches the configured initial normal candidates. The highest
  priority ready candidate wins; a lower-priority candidate remains held while
  a higher-priority candidate is still inside its SLA window.
- At a round boundary, at most one pending normal attempt is promoted to the
  fallback. The next round uses the remaining slots for new normal candidates,
  so `discoveryConcurrency=2` means `one fallback + one new candidate`.
- A fallback that has produced a valid prefix is held until the current normal
  window closes, all normal candidates fail, or no candidates remain. A normal
  winner always has precedence during the window.
- When `bill_hedge_losers` is enabled, a Discovery loser that already produced
  a protocol-valid prefix and reached ready state may reuse the legacy
  background drain and billing path. It is billed only after natural stream
  completion with a completion marker and explicit usage. All other losers are
  cancelled and their readers/agents/provider-session references are released.
- Sticky binding is written only after a natural, successful stream completion
  with the protocol completion marker and a generation-aware CAS. Fake-200,
  incomplete, and client-aborted streams do not create or renew Sticky.

Discovery is eligible only for supported streaming protocol families and when
the versioned Redis binding capability is available. If Redis capability is
unknown/unavailable, the existing provider selection and Hedge behavior remain
active.

The versioned binding scripts require the canonical binding, legacy provider,
legacy owner, lease, and cooldown keys to be evaluated atomically. On Redis
Cluster layouts where those keys do not share a slot and Redis returns
`CROSSSLOT` (or when Lua capability probing fails), the capability state is
`unavailable`; the service records that state and uses the tenant-checked
legacy wrapper. Discovery stays disabled until a later connection-lifecycle
probe succeeds.

## Rollout

1. Apply the system-settings migration.
2. Confirm the Redis versioned-binding capability probe is `available`.
3. Leave `discoveryEnabled=false` while validating the existing Hedge and
   versioned binding checks.
4. Enable Discovery for a controlled group, observe provider-chain outcomes,
   first-token latency, fallback promotions, cancellations, CAS conflicts, and
   final 503s.
5. Disable the setting to return immediately to the legacy Hedge path.

This feature does not change the final client failure contract: an exhausted
request continues to return the existing `503` mapping.
