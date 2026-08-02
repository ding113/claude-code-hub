# Site-based provider configuration + upstream billing

Branch: `feat/site-based-provider-config`
Worktree: `/root/claude-code-hub-site-config`

## Goal

Rewrite provider configuration around **websites**, not a flat list of keys.

Inspired by Upstream Hub:

```text
Website / Channel (opentoken, mdkj, nikoapi...)
  └─ Group rates (Claude Kiro 0.15, codex-Plus 0.07, ...)
       └─ API key / provider endpoint for that group
```

Also make request billing closer to upstream settlement instead of only CCH catalogue estimates.

## Current CCH reality

| Layer | Today |
|---|---|
| Config unit | Flat `providers` row (`opentoken-Claude Kiro`) |
| Rate source | UH sync writes one `providers.cost_multiplier` from website group ratio |
| User bill | `tokens × model_prices × provider.cost_multiplier × provider_groups.cost_multiplier` |
| UH today cost | Real account debit from NewAPI/Sub2API |

That is why probe/user spend can diverge from UH even when multipliers look correct.

## Target model

### 1. Configure by website

New tables:

- `provider_sites`
  - name, site_url, site_type (`sub2api|newapi|custom`)
  - optional `upstream_hub_channel_id`
- `provider_site_group_rates`
  - site_id + group_name + ratio + completion_ratio
  - dispatch_group_tag (`image|grok|claude|codex|other`)
- `providers` extensions
  - `site_id`
  - `site_group_name`
  - `billing_mode` (`catalog_estimate` default | `site_group_ratio`)

UI target:

1. Add website once (URL / type / notes)
2. Sync or paste group rates for that website
3. Attach one or more keys under a group
4. See group ratios on the site page without opening every provider card

### 2. Billing modes

| Mode | Formula | Use |
|---|---|---|
| `catalog_estimate` | tokens × CCH `model_prices` × provider mult × group mult | Legacy / non-UH sites |
| `site_group_ratio` | tokens × CCH `model_prices` × **website group ratio** (+ completion ratio if present) | Default for UH-managed websites |

Important honesty:

- UH public APIs expose **group ratios** and **account today_cost**, not per-request settlement rows.
- Therefore “按上游计费” in v1 means **use the website’s own group ratio as the multiplier**, not invent a fake per-request UH ledger.
- True per-request equality with UH still needs either:
  1. upstream usage-log cost fields if a site exposes them, or
  2. NewAPI-style quota formula with that site’s model price table + `quota_per_unit`, or
  3. post-hoc channel reconciliation against UH `today_cost`.

## Implemented in this branch so far

1. Branch/worktree created from clean `HEAD`
2. Schema + migration `0115_provider_sites_and_group_rates.sql`
3. Pure helpers:
   - `classifySiteGroupTag`
   - `resolveSiteBillingMultipliers`
   - `applySiteGroupCompletionRatio`
4. Unit tests for helpers

## Next implementation slices

1. Repository/API for sites + group rates CRUD/sync from UH DB or UH HTTP
2. Provider form: pick site + group instead of free-form multiplier-only create
3. Wire `response-handler` / health-test cost path to `billing_mode=site_group_ratio`
4. Admin UI: site list with group rate table
5. Optional: daily reconciliation report CCH attributed cost vs UH `today_cost`

## Non-goals for first cut

- Do not break existing flat providers (`site_id` nullable, default billing mode legacy)
- Do not hard-require UH for every provider
- Do not claim byte-equal totals with UH until a real per-request upstream cost source exists
